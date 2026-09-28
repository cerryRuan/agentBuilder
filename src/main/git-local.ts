import { app } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getCredential } from './credentials'
import { loadConfig } from './store'
import type { GitGlobalConfig, RepoConfig } from '../shared/types'

const execFileAsync = promisify(execFile)

export function repoCacheDir(repoId: string): string {
  const dir = join(app.getPath('userData'), 'repo-cache', repoId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function buildAuthedUrl(gitUrl: string, git: GitGlobalConfig): string {
  const secret = getCredential(git.credentialRef)
  if (!secret) return gitUrl

  try {
    const url = new URL(gitUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return gitUrl
    const user = git.username || 'oauth2'
    url.username = user
    url.password = secret
    return url.toString()
  } catch {
    return gitUrl
  }
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 20 * 1024 * 1024,
    timeout: 10 * 60 * 1000
  })
  return stdout.trim()
}

/** Embed credentials for remote ops without writing them into .git/config permanently when possible */
function authEnv(gitUrl: string, git: GitGlobalConfig): { url: string; env: NodeJS.ProcessEnv } {
  const url = buildAuthedUrl(gitUrl, git)
  return { url, env: {} }
}

export async function listBranchesFromGit(repo: RepoConfig): Promise<string[]> {
  const config = loadConfig()
  const { url } = authEnv(repo.gitUrl, config.git)
  const out = await git(app.getPath('temp'), ['ls-remote', '--heads', url])
  const branches = out
    .split('\n')
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      const ref = parts[1] || ''
      return ref.replace(/^refs\/heads\//, '')
    })
    .filter(Boolean)
  return [...new Set(branches)].sort()
}

async function ensureRemoteBranch(
  repo: RepoConfig,
  branch: string
): Promise<void> {
  const heads = await listBranchesFromGit(repo)
  if (heads.includes(branch)) return
  const hint =
    heads.length === 0
      ? '（远程未返回任何分支，请检查 Git 地址与凭证）'
      : `可用分支：${heads.slice(0, 20).join(', ')}${heads.length > 20 ? '…' : ''}`
  throw new Error(`仓库「${repo.name}」远程不存在分支「${branch}」。${hint}`)
}

export async function prepareLocalCheckout(
  repo: RepoConfig,
  branch: string,
  log: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void
): Promise<{ workDir: string; tip: string }> {
  const config = loadConfig()
  const { url } = authEnv(repo.gitUrl, config.git)
  const workDir = repoCacheDir(repo.id)
  const gitDir = join(workDir, '.git')

  await ensureRemoteBranch(repo, branch)

  if (!existsSync(gitDir)) {
    log('info', `本地克隆 ${repo.gitUrl} @ ${branch}`)
    rmSync(workDir, { recursive: true, force: true })
    const parent = join(app.getPath('userData'), 'repo-cache')
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    await git(parent, ['clone', '--branch', branch, '--single-branch', url, repo.id])
  } else {
    log('info', `更新本地缓存 ${repo.name} @ ${branch}`)
    await git(workDir, ['remote', 'set-url', 'origin', url])
    await git(workDir, [
      'fetch',
      '--prune',
      'origin',
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`
    ])
    await git(workDir, ['checkout', '-B', branch, `origin/${branch}`])
    await git(workDir, ['reset', '--hard', `origin/${branch}`])
  }

  // strip credentials from stored remote after ops
  try {
    await git(workDir, ['remote', 'set-url', 'origin', repo.gitUrl])
  } catch {
    /* ignore */
  }

  const tip = await git(workDir, ['log', '-1', '--pretty=format:%h %an %s'])
  log('info', `本地检出: ${tip}`)
  return { workDir, tip }
}

const EXCLUDE_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.idea',
  '.vscode',
  'target',
  'dist',
  'out',
  '.turbo',
  'coverage'
])

function shouldExcludePath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/).filter(Boolean)
  // tar package may pass '.' as entry
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '.')) return false
  return parts.some((p) => EXCLUDE_NAMES.has(p))
}

/** Create a tar.gz via Node (avoid Windows GNU tar treating C: as remote host) */
export async function createUploadArchive(
  workDir: string,
  archivePath: string
): Promise<void> {
  if (existsSync(archivePath)) rmSync(archivePath)

  const tar = await import('tar')
  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: workDir,
      portable: true,
      filter: (p) => !shouldExcludePath(p)
    },
    ['.']
  )
}

export function stagingDir(): string {
  const dir = join(app.getPath('temp'), 'agent-builder-upload')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
