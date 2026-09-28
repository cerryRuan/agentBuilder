import { randomUUID } from 'crypto'
import { join } from 'path'
import { rmSync, existsSync } from 'fs'
import { BrowserWindow } from 'electron'
import {
  AppConfig,
  HistoryRecord,
  PublishTask,
  SyncLogEvent
} from '../shared/types'
import { loadConfig, upsertHistory } from './store'
import { withSsh } from './ssh'
import { getCredential } from './credentials'
import {
  createUploadArchive,
  listBranchesFromGit,
  prepareLocalCheckout,
  repoCacheDir,
  stagingDir
} from './git-local'
import { uploadAndOverwrite } from './upload'
import { collectBuildRoles, packRemoteServiceImages, runRemoteBuildAndDeploy, servicesForBuildRoles } from './deploy-remote'

type LogFn = (level: SyncLogEvent['level'], message: string) => void

function emitLog(
  win: BrowserWindow | null,
  level: SyncLogEvent['level'],
  message: string
): void {
  const event: SyncLogEvent = {
    level,
    message,
    ts: new Date().toISOString(),
    channel: 'publish'
  }
  win?.webContents.send('sync:log', event)
}

export async function listRemoteBranches(
  _serverId: string,
  repoId: string
): Promise<string[]> {
  const config = loadConfig()
  const repo = config.repos.find((r) => r.id === repoId)
  if (!repo) throw new Error('找不到仓库')
  const branches = await listBranchesFromGit(repo)
  if (branches.length === 0 && repo.defaultBranch) return [repo.defaultBranch]
  return branches
}

export async function runPublishTask(
  task: PublishTask,
  getWindow: () => BrowserWindow | null
): Promise<HistoryRecord> {
  const config = loadConfig()
  const server = config.servers.find((s) => s.id === task.serverId)
  if (!server) throw new Error('服务器不存在')

  const selected = task.items.filter((i) => i.selected)
  if (selected.length === 0) throw new Error('请至少勾选一个仓库')

  if (!getCredential(config.git.credentialRef) && config.git.authType) {
    // warn only — some repos may be public / already cached
  }

  const record: HistoryRecord = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    serverId: server.id,
    serverName: server.name,
    mode: task.mode,
    status: 'running',
    items: selected.map((item) => {
      const repo = config.repos.find((r) => r.id === item.repoId)
      const mapping = config.mappings.find(
        (m) => m.serverId === task.serverId && m.repoId === item.repoId
      )
      return {
        repoId: item.repoId,
        repoName: repo?.name || item.repoId,
        branch: item.branch,
        remotePath: mapping?.remotePath || '',
        status: 'pending' as const
      }
    }),
    logTail: ''
  }

  const logs: string[] = []
  const log: LogFn = (level, message) => {
    logs.push(`[${level}] ${message}`)
    record.logTail = logs.slice(-200).join('\n')
    emitLog(getWindow(), level, message)
  }

  upsertHistory(record)
  log(
    'info',
    task.mode === 'sync-and-deploy'
      ? `开始上传并部署 → ${server.name} (${server.host})`
      : `开始上传覆盖 → ${server.name} (${server.host})`
  )

  try {
    await withSsh(server, async (client) => {
      for (let i = 0; i < selected.length; i++) {
        const item = selected[i]
        const histItem = record.items[i]
        const repo = config.repos.find((r) => r.id === item.repoId)
        const mapping = config.mappings.find(
          (m) => m.serverId === task.serverId && m.repoId === item.repoId
        )
        if (!repo || !mapping) {
          histItem.status = 'failed'
          histItem.message = '缺少仓库或路径映射'
          log('error', histItem.message)
          throw new Error(histItem.message)
        }
        if (!item.branch.trim()) {
          histItem.status = 'failed'
          histItem.message = '未选择分支'
          throw new Error(`${repo.name}: 未选择分支`)
        }

        histItem.status = 'running'
        upsertHistory(record)
        log('info', `—— ${repo.name} @ ${item.branch} → ${mapping.remotePath} ——`)

        const archivePath = join(stagingDir(), `${repo.id}-${Date.now()}.tar.gz`)
        try {
          const { tip, workDir } = await prepareLocalCheckout(repo, item.branch.trim(), log)
          log('info', '打包本地文件（排除 .git / node_modules / dist / target 等）')
          await createUploadArchive(workDir || repoCacheDir(repo.id), archivePath)
          await uploadAndOverwrite({
            client,
            localArchivePath: archivePath,
            remotePath: mapping.remotePath,
            log
          })
          histItem.status = 'success'
          histItem.message = tip
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          histItem.status = 'failed'
          histItem.message = msg
          log('error', msg)
          throw err
        } finally {
          if (existsSync(archivePath)) {
            try {
              rmSync(archivePath)
            } catch {
              /* ignore */
            }
          }
          upsertHistory(record)
        }
      }

      if (task.mode === 'sync-and-deploy') {
        const selectedRepos = selected
          .map((item) => config.repos.find((r) => r.id === item.repoId))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
        const roles = collectBuildRoles(selectedRepos)
        await runRemoteBuildAndDeploy({ client, server, roles, log })
        if (task.packImages !== false) {
          await packRemoteServiceImages({
            client,
            server,
            services: servicesForBuildRoles(roles),
            log
          })
        }
      }
    })

    record.status = 'success'
    record.finishedAt = new Date().toISOString()
    log(
      'success',
      task.mode === 'sync-and-deploy' ? '上传并部署全部完成' : '全部上传覆盖完成'
    )
  } catch (err) {
    record.status = 'failed'
    record.finishedAt = new Date().toISOString()
    const msg = err instanceof Error ? err.message : String(err)
    log('error', `任务失败: ${msg}`)
  }

  upsertHistory(record)
  return record
}

export function getConfigSnapshot(): AppConfig {
  return loadConfig()
}

export function credentialStatus(refs: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const ref of refs) {
    out[ref] = Boolean(getCredential(ref))
  }
  return out
}
