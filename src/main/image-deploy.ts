import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import type { Client, SFTPWrapper } from 'ssh2'
import type {
  DeployServiceInfo,
  DeployTargetCheck,
  HistoryRecord,
  ImageDeployTask,
  ImageFileInfo,
  ServerConfig,
  SyncLogEvent
} from '../shared/types'
import {
  APP_COMPOSE_SERVICES,
  filterActiveAppServices,
  servicesForImageNames
} from '../shared/image-services'
import { getCredential } from './credentials'
import { resolveDeployDir } from './deploy-remote'
import { loadConfig, upsertHistory } from './store'
import { execCommandStreaming, shellQuote, withSsh } from './ssh'

type LogFn = (level: SyncLogEvent['level'], message: string) => void

const REQUIRED_DEPLOY_RELATIVE = [
  'docker-compose.yml',
  'scripts/load-images.sh',
  'scripts/deploy.sh',
  'images'
] as const

function emitLog(win: BrowserWindow | null, level: SyncLogEvent['level'], message: string): void {
  const event: SyncLogEvent = {
    level,
    message,
    ts: new Date().toISOString(),
    channel: 'image-deploy'
  }
  win?.webContents.send('sync:log', event)
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err || !sftp) reject(err || new Error('无法打开 SFTP'))
      else resolve(sftp)
    })
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function imagesDirOf(server: ServerConfig): string {
  return `${resolveDeployDir(server)}/images`
}

const MIDDLEWARE_SERVICES = ['postgres', 'neo4j', 'qdrant', 'minio'] as const

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function isLikelyExternalHost(host: string): boolean {
  const h = host.trim().toLowerCase()
  if (!h) return false
  if (MIDDLEWARE_SERVICES.includes(h as (typeof MIDDLEWARE_SERVICES)[number])) return false
  if (h === 'localhost' || h === '127.0.0.1' || h === 'host.docker.internal') return true
  // IP
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true
  // other hostname
  return true
}

function extractHostFromUrl(raw: string): string {
  const v = raw.trim().replace(/^['"]|['"]$/g, '')
  if (!v) return ''
  // jdbc:postgresql://host:5432/db 、bolt://host:7687 、http://host:6333
  const schemeHost = v.match(/^[a-zA-Z0-9+.-]+:\/\/(?:[^@/?#]*@)?([^:/?#]+)/)
  if (schemeHost) return schemeHost[1]
  try {
    if (v.includes('://')) {
      return new URL(v).hostname
    }
  } catch {
    /* ignore */
  }
  // postgresql+psycopg://user:pass@host:5432/db（无标准 scheme 时）
  const at = v.match(/@([^:/]+)/)
  if (at) return at[1]
  // host:port 或 纯 host
  const hp = v.match(/^([^:/]+)/)
  return hp ? hp[1] : v
}

async function analyzeEnvironment(
  client: Client,
  deployDir: string
): Promise<Pick<
  DeployTargetCheck,
  | 'composeProfiles'
  | 'activeComposeServices'
  | 'runningServices'
  | 'services'
  | 'summary'
>> {
  const deployQ = shellQuote(deployDir)
  const script = `
set -e
cd ${deployQ}
PROFILES=""
if [ -f .env ]; then
  PROFILES=$(grep -E '^[[:space:]]*COMPOSE_PROFILES=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\\r' || true)
fi
echo "PROFILES=$PROFILES"
echo "ACTIVE_BEGIN"
docker compose config --services 2>/dev/null || true
echo "ACTIVE_END"
echo "PROFILE_BEGIN"
docker compose --profile bundled-infra config --services 2>/dev/null || true
echo "PROFILE_END"
echo "RUNNING_BEGIN"
docker compose ps -a --format '{{.Service}}|{{.State}}' 2>/dev/null || true
echo "RUNNING_END"
echo "PYENV_BEGIN"
if [ -f config/python/.env ]; then
  grep -E '^(POSTGRES_URL|NEO4J_URI|QDRANT_URL|MINIO_URL|MINIO_PUBLIC_URL)=' config/python/.env 2>/dev/null | tr -d '\\r' || true
fi
echo "PYENV_END"
echo "JAVAENV_BEGIN"
for f in config/java/application-postgresql.yaml config/java/application.yaml; do
  if [ -f "$f" ]; then
    grep -E 'url:|uri:|host:' "$f" 2>/dev/null | tr -d '\\r' || true
  fi
done
echo "JAVAENV_END"
`
  const res = await execCommandStreaming(client, script, () => undefined)
  const out = res.stdout || ''

  const profilesRaw = (out.match(/^PROFILES=(.*)$/m) || [])[1]?.trim() || ''
  const composeProfiles = profilesRaw
    ? profilesRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const activeComposeServices = parseLines(
    (out.match(/ACTIVE_BEGIN\r?\n([\s\S]*?)ACTIVE_END/) || [])[1] || ''
  )
  const profileServices = parseLines(
    (out.match(/PROFILE_BEGIN\r?\n([\s\S]*?)PROFILE_END/) || [])[1] || ''
  )
  const runningLines = parseLines(
    (out.match(/RUNNING_BEGIN\r?\n([\s\S]*?)RUNNING_END/) || [])[1] || ''
  )
  const runningMap = new Map<string, string>()
  for (const line of runningLines) {
    const [svc, state] = line.split('|')
    if (svc) runningMap.set(svc, (state || '').toLowerCase())
  }
  const runningServices = Array.from(runningMap.keys()).filter((k) => {
    const st = runningMap.get(k) || ''
    return st.includes('running') || st.includes('up')
  })

  const pyEnvBlock = (out.match(/PYENV_BEGIN\r?\n([\s\S]*?)PYENV_END/) || [])[1] || ''
  const javaEnvBlock = (out.match(/JAVAENV_BEGIN\r?\n([\s\S]*?)JAVAENV_END/) || [])[1] || ''
  const endpointHost: Record<string, string> = {}
  for (const line of parseLines(pyEnvBlock)) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    const val = line.slice(eq + 1)
    const host = extractHostFromUrl(val)
    if (!host) continue
    if (key.startsWith('POSTGRES')) endpointHost.postgres = host
    if (key.startsWith('NEO4J')) endpointHost.neo4j = host
    if (key.startsWith('QDRANT')) endpointHost.qdrant = host
    if (key === 'MINIO_URL' || key === 'MINIO_PUBLIC_URL') {
      if (!endpointHost.minio || key === 'MINIO_URL') endpointHost.minio = host
    }
  }
  // Java yaml：jdbc:postgresql://host:5432/... 等
  for (const line of parseLines(javaEnvBlock)) {
    const m = line.match(/:\s*(.+)$/)
    if (!m) continue
    const raw = m[1].trim()
    const host = extractHostFromUrl(raw)
    if (!host || host === 'YOUR_HOST') continue
    const lower = raw.toLowerCase()
    if (lower.includes('postgres') || lower.includes('jdbc:postgresql')) {
      if (!endpointHost.postgres) endpointHost.postgres = host
    } else if (lower.includes('neo4j') || lower.includes('bolt:')) {
      if (!endpointHost.neo4j) endpointHost.neo4j = host
    } else if (lower.includes('qdrant')) {
      if (!endpointHost.qdrant) endpointHost.qdrant = host
    } else if (lower.includes('minio')) {
      if (!endpointHost.minio) endpointHost.minio = host
    }
  }

  const bundledEnabled = composeProfiles.includes('bundled-infra')
  const services: DeployServiceInfo[] = []

  for (const name of APP_COMPOSE_SERVICES) {
    const inActive = activeComposeServices.includes(name)
    const running = runningServices.includes(name)
    if (inActive) {
      services.push({
        name,
        kind: 'app',
        mode: 'compose',
        running,
        detail: running ? 'compose 运行中' : 'compose 已定义但未运行'
      })
    } else {
      services.push({
        name,
        kind: 'app',
        mode: 'absent',
        running,
        detail: running
          ? '容器在跑，但不在当前 compose 默认服务列表'
          : '当前 compose 未包含该服务'
      })
    }
  }

  for (const name of MIDDLEWARE_SERVICES) {
    const inProfileDef = profileServices.includes(name)
    const running = runningServices.includes(name)
    const cfgHost = endpointHost[name] || ''
    const cfgExternal = cfgHost ? isLikelyExternalHost(cfgHost) : false

    if (cfgExternal) {
      services.push({
        name,
        kind: 'middleware',
        mode: 'external',
        running,
        detail: `配置指向外置 ${cfgHost}${running ? '（另有本地容器在跑，请确认是否冲突）' : ''}`
      })
    } else if (bundledEnabled || (inProfileDef && running)) {
      services.push({
        name,
        kind: 'middleware',
        mode: 'compose',
        running,
        detail: bundledEnabled
          ? running
            ? 'bundled-infra profile 启用，compose 运行中'
            : 'bundled-infra profile 启用，但容器未运行'
          : '无 profile，但本地仍有该 compose 容器在跑'
      })
    } else if (inProfileDef) {
      services.push({
        name,
        kind: 'middleware',
        mode: 'external',
        running: false,
        detail: 'compose 仅在 bundled-infra profile 定义，当前未启用 → 按外置中间件处理'
      })
    } else {
      services.push({
        name,
        kind: 'middleware',
        mode: cfgHost ? (cfgExternal ? 'external' : 'compose') : 'absent',
        running,
        detail: cfgHost
          ? `配置地址 ${cfgHost}`
          : '未在 compose / 配置中明确探测到'
      })
    }
  }

  const appCompose = services.filter((s) => s.kind === 'app' && s.mode === 'compose').map((s) => s.name)
  const mwExternal = services.filter((s) => s.kind === 'middleware' && s.mode === 'external').map((s) => s.name)
  const mwCompose = services.filter((s) => s.kind === 'middleware' && s.mode === 'compose').map((s) => s.name)

  const summaryParts = [
    `业务服务(compose): ${appCompose.join(', ') || '无'}`,
    mwCompose.length ? `中间件(compose): ${mwCompose.join(', ')}` : '',
    mwExternal.length
      ? `中间件(外置): ${mwExternal.join(', ')}`
      : mwCompose.length
        ? ''
        : '中间件未启用 bundled-infra（按外置处理）'
  ].filter(Boolean)

  return {
    composeProfiles,
    activeComposeServices,
    runningServices,
    services,
    summary: summaryParts.join('；')
  }
}

export async function checkDeployTarget(deployServerId: string): Promise<DeployTargetCheck> {
  const config = loadConfig()
  const server = config.servers.find((s) => s.id === deployServerId)
  if (!server) throw new Error('部署服务器不存在')
  if (server.role === 'package') throw new Error('请选择「部署服务器」类型')

  const deployDir = resolveDeployDir(server)
  const imagesDir = `${deployDir}/images`

  return withSsh(server, async (client) => {
    const present: string[] = []
    const missing: string[] = []
    for (const rel of REQUIRED_DEPLOY_RELATIVE) {
      const path = `${deployDir}/${rel}`
      const q = shellQuote(path)
      const res = await execCommandStreaming(
        client,
        `if [ -e ${q} ]; then echo YES; else echo NO; fi`,
        () => undefined
      )
      if (res.stdout.includes('YES')) present.push(rel)
      else missing.push(rel)
    }

    let analysis: Pick<
      DeployTargetCheck,
      | 'composeProfiles'
      | 'activeComposeServices'
      | 'runningServices'
      | 'services'
      | 'summary'
    > = {
      composeProfiles: [],
      activeComposeServices: [],
      runningServices: [],
      services: [],
      summary: '未能分析运行环境'
    }

    if (present.includes('docker-compose.yml')) {
      try {
        analysis = await analyzeEnvironment(client, deployDir)
      } catch (e) {
        analysis.summary = `环境分析失败: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    return {
      ok: missing.length === 0,
      deployDir,
      imagesDir,
      present,
      missing,
      ...analysis
    }
  })
}

async function listRemoteTarImages(client: Client, dir: string): Promise<ImageFileInfo[]> {
  const sftp = await openSftp(client)
  return new Promise<ImageFileInfo[]>((resolve, reject) => {
    sftp.readdir(dir, (err, files) => {
      if (err) {
        reject(new Error(`无法读取镜像目录 ${dir}: ${err.message}`))
        return
      }
      const items = files
        .filter((f) => f.filename.toLowerCase().endsWith('.tar'))
        .map((f) => ({
          name: f.filename,
          size: Number(f.attrs.size || 0),
          mtimeMs: Number(f.attrs.mtime || 0) * 1000
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
      resolve(items)
    })
  })
}

export async function listPackageImages(packageServerId: string): Promise<ImageFileInfo[]> {
  const config = loadConfig()
  const server = config.servers.find((s) => s.id === packageServerId)
  if (!server) throw new Error('打包服务器不存在')
  if (server.role === 'deploy') throw new Error('请选择「打包服务器」类型')
  const dir = imagesDirOf(server)
  return withSsh(server, async (client) => listRemoteTarImages(client, dir))
}

async function ensureRemoteDir(client: Client, dir: string): Promise<void> {
  const res = await execCommandStreaming(client, `mkdir -p ${shellQuote(dir)}`, () => undefined)
  if (res.code !== 0) throw new Error(`创建目录失败: ${dir}\n${res.stderr}`)
}

async function remoteFileSize(client: Client, path: string): Promise<number> {
  const sftp = await openSftp(client)
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => {
      if (err) reject(new Error(`无法读取源文件 ${path}: ${err.message}`))
      else resolve(Number(stats?.size || 0))
    })
  })
}

function sftpWriteText(sftp: SFTPWrapper, path: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(path)
    ws.on('error', reject)
    ws.on('close', () => resolve())
    ws.end(Buffer.from(text, 'utf-8'))
  })
}

/** 打包机 → 部署机：scp 直传（需打包机可达部署机，密码方式需 sshpass） */
async function transferViaRemoteScp(
  pkg: ServerConfig,
  dep: ServerConfig,
  srcPath: string,
  tmpDstPath: string,
  size: number,
  log: LogFn
): Promise<void> {
  const secret = getCredential(dep.credentialRef)
  if (!secret) throw new Error(`部署服务器「${dep.name}」未配置凭证`)

  const port = dep.port || 22
  const user = dep.username
  const host = dep.host
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpBase = `/tmp/agent-builder-xfer-${stamp}`

  await withSsh(pkg, async (client) => {
    const hasScp = (await execCommandStreaming(client, 'command -v scp', () => undefined)).code === 0
    if (!hasScp) throw new Error('打包机未安装 scp')

    const sftp = await openSftp(client)
    const cleanup = async (): Promise<void> => {
      await execCommandStreaming(
        client,
        `rm -f ${shellQuote(`${tmpBase}.pass`)} ${shellQuote(`${tmpBase}.key`)}`,
        () => undefined
      )
    }

    try {
      let scpCmd: string
      if (dep.authType === 'privateKey') {
        await sftpWriteText(sftp, `${tmpBase}.key`, secret)
        await execCommandStreaming(client, `chmod 600 ${shellQuote(`${tmpBase}.key`)}`, () => undefined)
        scpCmd = [
          'scp',
          '-i',
          shellQuote(`${tmpBase}.key`),
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'UserKnownHostsFile=/dev/null',
          '-o',
          'BatchMode=yes',
          '-P',
          String(port),
          shellQuote(srcPath),
          shellQuote(`${user}@${host}:${tmpDstPath}`)
        ].join(' ')
      } else {
        const hasSshpass = (await execCommandStreaming(client, 'command -v sshpass', () => undefined))
          .code === 0
        if (!hasSshpass) {
          throw new Error('打包机未安装 sshpass（密码直传需要）')
        }
        await sftpWriteText(sftp, `${tmpBase}.pass`, secret)
        await execCommandStreaming(client, `chmod 600 ${shellQuote(`${tmpBase}.pass`)}`, () => undefined)
        scpCmd = [
          'sshpass',
          '-f',
          shellQuote(`${tmpBase}.pass`),
          'scp',
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'UserKnownHostsFile=/dev/null',
          '-P',
          String(port),
          shellQuote(srcPath),
          shellQuote(`${user}@${host}:${tmpDstPath}`)
        ].join(' ')
      }

      log('info', `打包机直传 → ${dep.host}:${tmpDstPath}（${formatBytes(size)}）`)
      await runRemote(client, scpCmd, log, 'scp 直传')
    } finally {
      await cleanup()
    }
  })
}

/** 本机双 SSH SFTP 中继：不落盘，适合打包机无法直连部署机的情况 */
async function transferViaSftpRelay(
  pkg: ServerConfig,
  dep: ServerConfig,
  srcPath: string,
  tmpDstPath: string,
  size: number,
  log: LogFn
): Promise<void> {
  log('info', `本机中继传输（不落盘） ${formatBytes(size)}`)
  await withSsh(pkg, async (pkgClient) => {
    await withSsh(dep, async (depClient) => {
      const srcSftp = await openSftp(pkgClient)
      const dstSftp = await openSftp(depClient)
      await new Promise<void>((resolve, reject) => {
        const read = srcSftp.createReadStream(srcPath, { highWaterMark: 1024 * 1024 })
        const write = dstSftp.createWriteStream(tmpDstPath)
        let transferred = 0
        let lastPct = -1
        read.on('data', (chunk: Buffer | string) => {
          transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
          if (!size) return
          const pct = Math.floor((transferred / size) * 100)
          if (pct >= lastPct + 5 || pct === 100) {
            lastPct = pct
            log('info', `中继 ${pct}%（${formatBytes(transferred)} / ${formatBytes(size)}）`)
          }
        })
        read.on('error', reject)
        write.on('error', reject)
        write.on('close', () => resolve())
        read.pipe(write)
      })
    })
  })
}

/** 现场机 python 容器把此目录挂到 /app/app，服务部署必须同步，否则只换镜像仍跑旧代码 */
function pythonCodeMountDir(server: ServerConfig): string {
  return `${resolveDeployDir(server)}/data/python/code`
}

function needsPythonCodeSync(imageNames: string[]): boolean {
  return servicesForImageNames(imageNames).includes('python-agent')
}

/**
 * 打包机 deploy/data/python/code → 部署机同路径。
 * 现场 compose 用 bind mount 覆盖镜像内代码，不传这份目录会出现「镜像新、接口仍 404」。
 */
async function syncPythonCodeMount(
  pkg: ServerConfig,
  dep: ServerConfig,
  log: LogFn
): Promise<void> {
  const srcDir = pythonCodeMountDir(pkg)
  const dstDir = pythonCodeMountDir(dep)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const srcTar = `/tmp/agent-builder-python-code-${stamp}.tgz`
  const dstTar = `/tmp/agent-builder-python-code-${stamp}.tgz`

  log('info', `—— 同步 Python 代码挂载目录 ——`)
  log('info', `${pkg.host}:${srcDir} → ${dep.host}:${dstDir}`)

  await withSsh(pkg, async (client) => {
    const check = await execCommandStreaming(
      client,
      `if [ -d ${shellQuote(srcDir)} ] && [ "$(ls -A ${shellQuote(srcDir)} 2>/dev/null | head -1)" ]; then echo YES; else echo NO; fi`,
      () => undefined
    )
    if (!check.stdout.includes('YES')) {
      throw new Error(
        `打包机缺少 Python 代码目录或内容为空: ${srcDir}（请先在发布页同步并构建 python）`
      )
    }
    await runRemote(
      client,
      [
        `rm -f ${shellQuote(srcTar)}`,
        `tar -czf ${shellQuote(srcTar)} -C ${shellQuote(srcDir)} .`,
        `ls -lh ${shellQuote(srcTar)}`,
        `tar -tzf ${shellQuote(srcTar)} | head -20`
      ].join(' && '),
      log,
      '打包机打包 data/python/code'
    )
  })

  try {
    await transferImage(pkg, dep, srcTar, dstTar, log)
    await withSsh(dep, async (client) => {
      await runRemote(
        client,
        [
          `mkdir -p ${shellQuote(dstDir)}`,
          `tar -xzf ${shellQuote(dstTar)} -C ${shellQuote(dstDir)}`,
          `rm -f ${shellQuote(dstTar)}`,
          `test -d ${shellQuote(`${dstDir}/api`)} -o -f ${shellQuote(`${dstDir}/main.py`)}`,
          `wc -l ${shellQuote(`${dstDir}/api/v1/wiki.py`)} 2>/dev/null || true`,
          `grep -c "preview/tasks" ${shellQuote(`${dstDir}/api/v1/wiki.py`)} 2>/dev/null || echo 0`
        ].join(' && '),
        log,
        '部署机解压 data/python/code'
      )
    })
    log('success', `Python 代码挂载已同步 → ${dstDir}`)
  } finally {
    await withSsh(pkg, async (client) => {
      await execCommandStreaming(client, `rm -f ${shellQuote(srcTar)}`, () => undefined)
    })
  }
}

async function transferImage(
  pkg: ServerConfig,
  dep: ServerConfig,
  srcPath: string,
  dstPath: string,
  log: LogFn
): Promise<void> {
  const tmpDst = `${dstPath}.uploading`
  let size = 0
  await withSsh(pkg, async (client) => {
    size = await remoteFileSize(client, srcPath)
  })
  await withSsh(dep, async (client) => {
    const dir = dstPath.includes('/') ? dstPath.slice(0, dstPath.lastIndexOf('/')) : '.'
    await ensureRemoteDir(client, dir)
    // 清理可能残留的半截文件
    await execCommandStreaming(client, `rm -f ${shellQuote(tmpDst)}`, () => undefined)
  })

  let mode: 'scp' | 'relay' = 'scp'
  try {
    await transferViaRemoteScp(pkg, dep, srcPath, tmpDst, size, log)
  } catch (e) {
    mode = 'relay'
    const msg = e instanceof Error ? e.message : String(e)
    log('info', `服务器直传未成功（${msg}），改用本机中继`)
    await transferViaSftpRelay(pkg, dep, srcPath, tmpDst, size, log)
  }

  await withSsh(dep, async (client) => {
    const mv = await execCommandStreaming(
      client,
      `mv -f ${shellQuote(tmpDst)} ${shellQuote(dstPath)}`,
      () => undefined
    )
    if (mv.code !== 0) {
      throw new Error(`替换镜像失败: ${mv.stderr || mv.stdout}`)
    }
  })
  log('success', `已覆盖目标（${mode === 'scp' ? '服务器直传' : '本机中继'}）: ${dstPath}`)
}

async function runRemote(
  client: Client,
  command: string,
  log: LogFn,
  label: string
): Promise<void> {
  log('info', `执行: ${label}`)
  // 不把含密码的命令完整打到日志；scp 命令本身不含明文密码
  if (!command.includes('sshpass') && command.length < 300) {
    log('info', `$ ${command}`)
  } else {
    log('info', `$ scp … → 部署机`)
  }
  const result = await execCommandStreaming(client, command, (chunk) => {
    for (const line of chunk.split(/\r?\n/).filter((l) => l.trim())) {
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

export async function runImageDeploy(
  task: ImageDeployTask,
  getWindow: () => BrowserWindow | null
): Promise<HistoryRecord> {
  const config = loadConfig()
  const pkg = config.servers.find((s) => s.id === task.packageServerId)
  const dep = config.servers.find((s) => s.id === task.deployServerId)
  if (!dep) throw new Error('部署服务器不存在')
  if (dep.role === 'package') throw new Error('目标服务器必须是部署服务器')
  if (!task.imageNames.length) throw new Error('请至少选择一个镜像包')

  const step = task.step || 'all'
  const doTransfer = step === 'all' || step === 'transfer'
  const doApply = step === 'all' || step === 'apply'
  const stepLabel =
    step === 'transfer' ? '仅上传' : step === 'apply' ? '仅执行' : '上传并执行'

  if (doTransfer) {
    if (!pkg) throw new Error('打包服务器不存在')
    if (pkg.role === 'deploy') throw new Error('源服务器必须是打包服务器')
  }

  const win = getWindow()
  const record: HistoryRecord = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    serverId: dep.id,
    serverName:
      step === 'apply' || !pkg
        ? `${dep.name}（${stepLabel}）`
        : `${pkg.name} → ${dep.name}（${stepLabel}）`,
    mode: 'image-deploy',
    status: 'running',
    items: task.imageNames.map((name) => ({
      repoId: name,
      repoName: name,
      branch: stepLabel,
      remotePath: `${resolveDeployDir(dep)}/images/${name}`,
      status: 'pending' as const
    })),
    logTail: ''
  }
  const logs: string[] = []
  const log: LogFn = (level, message) => {
    logs.push(`[${level}] ${message}`)
    record.logTail = logs.slice(-200).join('\n')
    emitLog(win, level, message)
  }
  upsertHistory(record)

  try {
    const check = await checkDeployTarget(dep.id)
    if (!check.ok) {
      throw new Error(
        `部署目录检查未通过（${check.deployDir}），缺少: ${check.missing.join(', ')}`
      )
    }

    const dstImages = check.imagesDir
    log('info', `服务部署步骤：${stepLabel}`)
    if (check.summary) log('info', `目标环境: ${check.summary}`)

    if (doTransfer) {
      if (!pkg) throw new Error('打包服务器不存在')
      const srcImages = imagesDirOf(pkg)
      log(
        'info',
        `开始上传：${pkg.name}(${pkg.host}) → ${dep.name}(${dep.host})，共 ${task.imageNames.length} 个包（优先服务器直传）`
      )
      for (let i = 0; i < task.imageNames.length; i++) {
        const name = task.imageNames[i]
        const histItem = record.items[i]
        if (name.includes('/') || name.includes('\\') || name.includes('..')) {
          throw new Error(`非法镜像文件名: ${name}`)
        }
        histItem.status = 'running'
        upsertHistory(record)
        log('info', `—— 传输 ${name} ——`)
        try {
          await transferImage(pkg, dep, `${srcImages}/${name}`, `${dstImages}/${name}`, log)
          histItem.status = 'success'
        } catch (e) {
          histItem.status = 'failed'
          histItem.message = e instanceof Error ? e.message : String(e)
          throw e
        }
        upsertHistory(record)
      }
      log('success', '镜像上传完成')
    }

    // Python 现场机用 bind mount 覆盖 /app/app，必须同步代码目录（镜像 alone 不够）
    if (needsPythonCodeSync(task.imageNames)) {
      if (!pkg || pkg.role === 'deploy') {
        throw new Error(
          '部署 Python 需选择打包服务器，以便同步 data/python/code（现场挂载目录，不传会仍跑旧代码）'
        )
      }
      await syncPythonCodeMount(pkg, dep, log)
    }

    if (doApply) {
      // 仅执行时确认目标机已有这些 tar
      if (!doTransfer) {
        await withSsh(dep, async (client) => {
          for (const name of task.imageNames) {
            if (name.includes('/') || name.includes('\\') || name.includes('..')) {
              throw new Error(`非法镜像文件名: ${name}`)
            }
            const path = `${dstImages}/${name}`
            const exists = await execCommandStreaming(
              client,
              `if [ -f ${shellQuote(path)} ]; then echo YES; else echo NO; fi`,
              () => undefined
            )
            if (!exists.stdout.includes('YES')) {
              throw new Error(`目标机缺少镜像包，请先上传: ${path}`)
            }
          }
        })
        for (const item of record.items) item.status = 'running'
        upsertHistory(record)
      }

      await withSsh(dep, async (client) => {
        const deployQ = shellQuote(check.deployDir)
        const loadArgs = task.imageNames.map((n) => shellQuote(n)).join(' ')
        await runRemote(
          client,
          `cd ${deployQ} && bash scripts/load-images.sh ${loadArgs}`,
          log,
          `load-images.sh（仅 ${task.imageNames.join(', ')}）`
        )

        const wanted = servicesForImageNames(task.imageNames)
        const toRestart = filterActiveAppServices(wanted, check.activeComposeServices)
        const skipped = wanted.filter((s) => !toRestart.includes(s))
        if (skipped.length) {
          log('info', `跳过未在当前 compose 激活的服务: ${skipped.join(', ')}`)
        }

        if (toRestart.length > 0) {
          await runRemote(
            client,
            `cd ${deployQ} && docker compose up -d --no-build --force-recreate ${toRestart.join(' ')}`,
            log,
            `重启业务服务 ${toRestart.join(', ')}`
          )
        } else {
          log('info', '没有可重启的业务服务（镜像已 load，请确认 compose 服务名与镜像对应关系）')
        }

        await runRemote(client, `cd ${deployQ} && docker compose ps`, log, '查看容器状态')
      })

      for (const item of record.items) {
        if (item.status !== 'failed') item.status = 'success'
      }
      log('success', 'load + 重启完成')
    }

    record.status = 'success'
    record.finishedAt = new Date().toISOString()
    log('success', `服务部署完成（${stepLabel}）`)
  } catch (err) {
    record.status = 'failed'
    record.finishedAt = new Date().toISOString()
    const msg = err instanceof Error ? err.message : String(err)
    log('error', `任务失败: ${msg}`)
  }

  upsertHistory(record)
  return record
}

/** 供调试：路径拼接 */
export function __debugPaths(server: ServerConfig): { deployDir: string; imagesDir: string } {
  return { deployDir: resolveDeployDir(server), imagesDir: imagesDirOf(server) }
}
