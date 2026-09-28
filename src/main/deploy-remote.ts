import type { Client } from 'ssh2'
import type { BuildRole, RepoConfig, ServerConfig } from '../shared/types'
import { execCommandStreaming, shellQuote } from './ssh'

type LogFn = (level: 'info' | 'success' | 'warn' | 'error', message: string) => void

export function resolveDeployDir(server: ServerConfig): string {
  if (server.deployDir?.trim()) return server.deployDir.trim().replace(/\/+$/, '')
  const root = (server.rootDir || '').trim().replace(/\/+$/, '')
  // 部署服务器的 deploy 根目录通常就是 /home/deploy，不再拼一层 /deploy
  if (server.role === 'deploy') return root || '/home/deploy'
  if (root) return `${root}/deploy`
  return '/home/ai_package/deploy'
}

export function collectBuildRoles(repos: RepoConfig[]): Set<BuildRole> {
  const roles = new Set<BuildRole>()
  for (const r of repos) {
    const role = r.buildRole || 'none'
    if (role !== 'none') roles.add(role)
  }
  return roles
}

async function runRemote(
  client: Client,
  command: string,
  log: LogFn,
  label: string
): Promise<void> {
  log('info', `执行: ${label}`)
  log('info', `$ ${command}`)

  const result = await execCommandStreaming(client, command, (chunk) => {
    const lines = chunk.split(/\r?\n/).filter((l) => l.trim())
    for (const line of lines) {
      // keep log volume reasonable
      const text = line.length > 500 ? `${line.slice(0, 500)}…` : line
      log('info', text)
    }
  })

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-2000)
    throw new Error(`${label} 失败 (exit ${result.code})${detail ? `\n${detail}` : ''}`)
  }
  log('success', `${label} 完成`)
}

/**
 * After source upload: build artifacts then rebuild/restart related compose services.
 */
export async function runRemoteBuildAndDeploy(opts: {
  client: Client
  server: ServerConfig
  roles: Set<BuildRole>
  log: LogFn
}): Promise<void> {
  const { client, server, roles, log } = opts
  if (roles.size === 0) {
    log('warn', '所选仓库未配置构建角色，跳过构建部署（请在仓库管理中设置）')
    return
  }

  const deployDir = resolveDeployDir(server)
  const deployQ = shellQuote(deployDir)
  // Prefer Node 22 installed at /opt/node-current (packaging hosts often have old /usr/bin/node)
  const nodePathPrefix = 'export PATH="/opt/node-current/bin:/usr/local/bin:$PATH"'

  log('info', `—— 开始构建部署（${[...roles].join(', ')}）deploy=${deployDir} ——`)

  const check = await execCommandStreaming(
    client,
    `if [ -d ${deployQ} ] && [ -f ${deployQ}/docker-compose.yml ]; then echo OK; else echo MISSING; fi`,
    () => undefined
  )
  if (!check.stdout.includes('OK')) {
    throw new Error(`找不到部署目录或 docker-compose.yml: ${deployDir}`)
  }

  const withNode = (cmd: string): string => `${nodePathPrefix} && ${cmd}`

  // 1) Build artifacts on host
  if (roles.has('web') && roles.has('h5') && roles.has('java')) {
    await runRemote(
      client,
      withNode(`cd ${deployQ} && bash scripts/build-all.sh`),
      log,
      'build-all（web+h5+java）'
    )
  } else {
    if (roles.has('java')) {
      await runRemote(
        client,
        withNode(`cd ${deployQ} && bash scripts/build-java.sh`),
        log,
        'build-java'
      )
    }
    if (roles.has('web')) {
      await runRemote(
        client,
        withNode(`cd ${deployQ} && bash scripts/build-frontend.sh`),
        log,
        'build-frontend'
      )
    }
    if (roles.has('h5')) {
      await runRemote(
        client,
        withNode(`cd ${deployQ} && bash scripts/build-h5.sh`),
        log,
        'build-h5'
      )
    }
  }

  // python: optional code sync helper if present, then always rebuild image when role selected
  if (roles.has('python')) {
    const syncScript = await execCommandStreaming(
      client,
      `if [ -f ${deployQ}/scripts/sync-python-code.sh ]; then echo YES; else echo NO; fi`,
      () => undefined
    )
    if (syncScript.stdout.includes('YES')) {
      await runRemote(
        client,
        `cd ${deployQ} && bash scripts/sync-python-code.sh`,
        log,
        'sync-python-code'
      )
    }
  }

  // 2) Docker compose build + up (business services only)
  const services: string[] = []
  if (roles.has('web') || roles.has('h5')) services.push('frontend')
  if (roles.has('java')) services.push('java-backend')
  if (roles.has('python')) services.push('python-agent')

  const uniqueServices = [...new Set(services)]
  if (uniqueServices.length === 0) return

  const svc = uniqueServices.join(' ')
  await runRemote(
    client,
    `cd ${deployQ} && docker compose build ${svc}`,
    log,
    `docker compose build ${svc}`
  )
  await runRemote(
    client,
    `cd ${deployQ} && docker compose up -d --no-deps ${svc}`,
    log,
    `docker compose up -d ${svc}`
  )

  // light health hint
  await runRemote(
    client,
    `cd ${deployQ} && docker compose ps ${svc}`,
    log,
    '查看容器状态'
  )

  log('success', '构建部署完成')
}

/** compose 服务 → 镜像名 / 离线 tar 文件名（与服务部署页一致） */
const SERVICE_IMAGE_TAR: Record<string, { image: string; tar: string }> = {
  frontend: { image: 'park-ai/agent-frontend:latest', tar: 'park-ai-frontend.tar' },
  'java-backend': { image: 'park-ai/agent-java:latest', tar: 'park-ai-java-backend.tar' },
  'python-agent': { image: 'park-ai/agent-python:latest', tar: 'park-ai-python-agent.tar' }
}

/**
 * 将本次构建的业务镜像导出为 deploy/images 下的单个 tar，供「服务部署」传输。
 * 不跑完整 pack-images.sh（避免再拉 infra / 打 all 大包）。
 */
export async function packRemoteServiceImages(opts: {
  client: Client
  server: ServerConfig
  services: string[]
  log: LogFn
}): Promise<void> {
  const { client, server, services, log } = opts
  const unique = [...new Set(services)].filter((s) => SERVICE_IMAGE_TAR[s])
  if (unique.length === 0) {
    log('warn', '没有可打包的业务服务镜像，跳过')
    return
  }

  const deployDir = resolveDeployDir(server)
  const deployQ = shellQuote(deployDir)
  const imagesDir = `${deployDir}/images`
  const imagesQ = shellQuote(imagesDir)

  log('info', `—— 打包镜像（${unique.join(', ')}）→ ${imagesDir} ——`)
  await runRemote(client, `mkdir -p ${imagesQ}`, log, '确保 images 目录')

  for (const svc of unique) {
    const { image, tar } = SERVICE_IMAGE_TAR[svc]
    const tarPath = `${imagesDir}/${tar}`
    const tmpPath = `${tarPath}.packing`
    // 先写临时文件再 mv，避免半截 tar 被服务部署读到
    await runRemote(
      client,
      [
        `cd ${deployQ}`,
        `docker image inspect ${shellQuote(image)} >/dev/null`,
        `rm -f ${shellQuote(tmpPath)}`,
        `docker save -o ${shellQuote(tmpPath)} ${shellQuote(image)}`,
        `mv -f ${shellQuote(tmpPath)} ${shellQuote(tarPath)}`,
        `chmod 644 ${shellQuote(tarPath)}`,
        `ls -lh ${shellQuote(tarPath)}`
      ].join(' && '),
      log,
      `导出 ${tar}（${image}）`
    )
  }

  await runRemote(
    client,
    `ls -lh ${imagesQ}/park-ai-*.tar 2>/dev/null || true`,
    log,
    '列出 images 目录'
  )
  log('success', '镜像打包完成，可在「服务部署」中传输到现场机')
}

/** 根据构建角色得到要导出的 compose 服务名 */
export function servicesForBuildRoles(roles: Set<BuildRole>): string[] {
  const services: string[] = []
  if (roles.has('web') || roles.has('h5')) services.push('frontend')
  if (roles.has('java')) services.push('java-backend')
  if (roles.has('python')) services.push('python-agent')
  return [...new Set(services)]
}
