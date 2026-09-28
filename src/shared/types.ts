export type GitAuthType = 'token' | 'password'
export type ServerAuthType = 'password' | 'privateKey'
export type PublishMode = 'sync-only' | 'sync-and-deploy'

/** 打包机（源码构建）或现场部署机（load 镜像） */
export type ServerRole = 'package' | 'deploy'

/** 上传后对应 deploy 脚本 / compose 服务 */
export type BuildRole = 'none' | 'web' | 'h5' | 'java' | 'python'

export interface GitGlobalConfig {
  baseUrl: string
  authType: GitAuthType
  username: string
  /** safeStorage key ref */
  credentialRef: string
}

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: ServerAuthType
  credentialRef: string
  /** package=打包服务器；deploy=现场部署服务器 */
  role: ServerRole
  rootDir: string
  /** 默认 `${rootDir}/deploy`；部署机多为 /home/deploy */
  deployDir?: string
}

export interface RepoConfig {
  id: string
  name: string
  gitUrl: string
  defaultBranch: string
  enabled: boolean
  /** 决定上传后执行哪类构建部署 */
  buildRole: BuildRole
}

export interface MappingConfig {
  id: string
  repoId: string
  serverId: string
  remotePath: string
}

export interface AppConfig {
  git: GitGlobalConfig
  servers: ServerConfig[]
  repos: RepoConfig[]
  mappings: MappingConfig[]
  ui: UiPreferences
}

/** 全局界面偏好 */
export type AppTheme = 'deep-blue' | 'midnight' | 'ocean' | 'light'

export interface UiPreferences {
  theme: AppTheme
}

export const THEME_LABELS: Record<AppTheme, string> = {
  'deep-blue': '深蓝（默认，略亮）',
  midnight: '午夜蓝（更深）',
  ocean: '海青蓝（再亮一点）',
  light: '浅色（明亮）'
}

/** Windows titleBarOverlay 颜色（须与 CSS --panel / --bg 对齐） */
export const THEME_TITLEBAR: Record<
  AppTheme,
  { overlay: string; symbol: string; background: string; native: 'light' | 'dark' }
> = {
  'deep-blue': {
    overlay: '#1e2d40',
    symbol: '#eef3fa',
    background: '#152230',
    native: 'dark'
  },
  midnight: {
    overlay: '#1a222c',
    symbol: '#e7eef7',
    background: '#0f1419',
    native: 'dark'
  },
  ocean: {
    overlay: '#243a58',
    symbol: '#f2f6fc',
    background: '#1a2b45',
    native: 'dark'
  },
  light: {
    overlay: '#ffffff',
    symbol: '#1c2b3d',
    background: '#eef2f8',
    native: 'light'
  }
}

export interface PublishItem {
  repoId: string
  branch: string
  selected: boolean
}

export interface PublishTask {
  serverId: string
  items: PublishItem[]
  mode: PublishMode
  /** sync-and-deploy 时：构建部署后导出 images/*.tar，供「服务部署」使用 */
  packImages?: boolean
}

export interface ImageFileInfo {
  name: string
  size: number
  mtimeMs: number
}

/** compose=本机 compose 编排；external=外置中间件/外部地址；absent=未定义 */
export type DeployServiceMode = 'compose' | 'external' | 'absent'

export interface DeployServiceInfo {
  name: string
  kind: 'app' | 'middleware'
  mode: DeployServiceMode
  running: boolean
  /** 简短说明，如配置地址、profile 状态 */
  detail: string
}

export interface DeployTargetCheck {
  ok: boolean
  deployDir: string
  imagesDir: string
  present: string[]
  missing: string[]
  /** .env 中 COMPOSE_PROFILES */
  composeProfiles: string[]
  /** 当前默认 profile 下 compose 会启动的服务 */
  activeComposeServices: string[]
  /** 当前项目正在运行的 compose 服务名 */
  runningServices: string[]
  /** 业务 + 中间件探测结果 */
  services: DeployServiceInfo[]
  /** 一句话总结 */
  summary: string
}

export type ImageDeployStep = 'transfer' | 'apply' | 'all'

export interface ImageDeployTask {
  packageServerId: string
  deployServerId: string
  /** 仅文件名，如 park-ai-frontend.tar */
  imageNames: string[]
  /**
   * transfer=仅上传镜像包；apply=仅 load + 重启（目标机已有 tar）；
   * all=上传并执行（默认）
   */
  step?: ImageDeployStep
}

export interface HistoryRecord {
  id: string
  startedAt: string
  finishedAt?: string
  serverId: string
  serverName: string
  mode: HistoryMode
  status: 'running' | 'success' | 'failed'
  items: Array<{
    repoId: string
    repoName: string
    branch: string
    remotePath: string
    status: 'pending' | 'running' | 'success' | 'failed'
    message?: string
  }>
  logTail: string
}

export const DEFAULT_CONFIG: AppConfig = {
  git: {
    baseUrl: '',
    authType: 'token',
    username: '',
    credentialRef: 'git.credential'
  },
  servers: [],
  repos: [],
  mappings: [],
  ui: {
    theme: 'deep-blue'
  }
}

export const BUILD_ROLE_LABELS: Record<BuildRole, string> = {
  none: '仅上传（不构建）',
  web: 'Web 前端 → build-frontend + frontend 容器',
  h5: 'H5 → build-h5 + frontend 容器',
  java: 'Java → build-java + java-backend',
  python: 'Python → sync/build + python-agent'
}

export const SERVER_ROLE_LABELS: Record<ServerRole, string> = {
  package: '打包服务器',
  deploy: '部署服务器'
}

export const SERVER_ROLE_DEFAULTS: Record<
  ServerRole,
  { rootDir: string; deployDir: string }
> = {
  package: { rootDir: '/home/ai_package', deployDir: '/home/ai_package/deploy' },
  deploy: { rootDir: '/home/deploy', deployDir: '/home/deploy' }
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error'

/** 日志通道：避免发布 / 服务部署串台 */
export type SyncLogChannel = 'publish' | 'image-deploy'

export interface SyncLogEvent {
  level: LogLevel
  message: string
  ts: string
  channel?: SyncLogChannel
}

export type HistoryMode = PublishMode | 'image-deploy'

export const HISTORY_MODE_LABELS: Record<HistoryMode, string> = {
  'sync-only': '发布·仅上传',
  'sync-and-deploy': '发布·上传部署',
  'image-deploy': '服务部署'
}

export function historyModeKind(mode: HistoryMode | string): 'publish' | 'image-deploy' {
  return mode === 'image-deploy' ? 'image-deploy' : 'publish'
}
