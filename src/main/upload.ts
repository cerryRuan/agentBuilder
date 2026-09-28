import { createReadStream } from 'fs'
import { basename } from 'path'
import type { Client } from 'ssh2'
import { execCommand, shellQuote } from './ssh'

type LogFn = (level: 'info' | 'success' | 'warn' | 'error', message: string) => void

function sftpOpen(client: Client): Promise<import('ssh2').SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })
}

function sftpUpload(
  sftp: import('ssh2').SFTPWrapper,
  localPath: string,
  remotePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const read = createReadStream(localPath)
    const write = sftp.createWriteStream(remotePath)
    write.on('close', () => resolve())
    write.on('error', reject)
    read.on('error', reject)
    read.pipe(write)
  })
}

/**
 * Upload archive and extract into remotePath, replacing directory contents.
 * Does NOT require remote path to be a git repo.
 */
export async function uploadAndOverwrite(opts: {
  client: Client
  localArchivePath: string
  remotePath: string
  log: LogFn
}): Promise<void> {
  const { client, localArchivePath, remotePath, log } = opts

  const normalized = remotePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized.startsWith('/') || normalized.split('/').filter(Boolean).length < 2) {
    throw new Error(`远程路径不安全或过短，已拒绝: ${remotePath}`)
  }
  const forbidden = new Set(['/home', '/root', '/etc', '/var', '/usr', '/opt', '/data', '/app'])
  if (forbidden.has(normalized)) {
    throw new Error(`禁止覆盖系统目录: ${normalized}`)
  }

  const pathQ = shellQuote(normalized)
  const remoteTmp = `/tmp/agent-builder-${Date.now()}-${Math.random().toString(16).slice(2)}.tar.gz`
  const remoteTmpQ = shellQuote(remoteTmp)

  log('info', `确保远程目录存在: ${normalized}`)
  const mkdir = await execCommand(client, `mkdir -p ${pathQ}`)
  if (mkdir.code !== 0) {
    throw new Error(mkdir.stderr || `无法创建目录 ${normalized}`)
  }

  log('info', `上传压缩包 → ${remoteTmp}`)
  const sftp = await sftpOpen(client)
  try {
    await sftpUpload(sftp, localArchivePath, remoteTmp)
  } finally {
    sftp.end()
  }

  log('info', `清空并解压覆盖 ${normalized}`)
  const extract = await execCommand(
    client,
    [
      `mkdir -p ${pathQ}`,
      `find ${pathQ} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
      `tar -xzf ${remoteTmpQ} -C ${pathQ}`,
      `rm -f ${remoteTmpQ}`,
      `echo DONE && find ${pathQ} -mindepth 1 -maxdepth 1 | wc -l`
    ].join(' && ')
  )

  if (extract.code !== 0) {
    await execCommand(client, `rm -f ${remoteTmpQ}`).catch(() => undefined)
    throw new Error(extract.stderr || extract.stdout || '远程解压失败')
  }

  const lines = extract.stdout.trim().split('\n')
  const count = lines[lines.length - 1] || '?'
  log('success', `覆盖完成（顶层条目约 ${count} 个）← ${basename(localArchivePath)}`)
}
