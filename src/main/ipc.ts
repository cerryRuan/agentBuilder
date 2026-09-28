import { randomUUID } from 'crypto'
import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { AppConfig, AppTheme, ImageDeployTask, PublishTask, ServerConfig, THEME_TITLEBAR } from '../shared/types'
import { loadConfig, saveConfig, loadHistory } from './store'
import { setCredential, hasCredential, getCredential } from './credentials'
import { testSshConnection } from './ssh'
import { listRemoteBranches, runPublishTask } from './sync'
import { checkDeployTarget, listPackageImages, runImageDeploy } from './image-deploy'

let getMainWindow: () => BrowserWindow | null = () => null

export function setMainWindowGetter(fn: () => BrowserWindow | null): void {
  getMainWindow = fn
}

export function applyWindowTheme(theme: string): boolean {
  const win = getMainWindow()
  const key = (theme in THEME_TITLEBAR ? theme : 'deep-blue') as AppTheme
  const palette = THEME_TITLEBAR[key]

  nativeTheme.themeSource = palette.native

  if (!win) return false
  try {
    if (typeof win.setTitleBarOverlay === 'function') {
      win.setTitleBarOverlay({
        color: palette.overlay,
        symbolColor: palette.symbol,
        height: 36
      })
    }
    win.setBackgroundColor(palette.background)
    return true
  } catch (err) {
    console.error('[ui:setTitleBar] failed', err)
    return false
  }
}

export function registerIpc(): void {
  ipcMain.handle('config:get', () => loadConfig())

  ipcMain.handle('config:save', (_e, config: AppConfig) => {
    saveConfig(config)
    return loadConfig()
  })

  ipcMain.handle('credential:set', (_e, ref: string, value: string) => {
    setCredential(ref, value)
    return true
  })

  ipcMain.handle('credential:get', (_e, ref: string) => getCredential(ref))

  ipcMain.handle('credential:has', (_e, ref: string) => hasCredential(ref))

  ipcMain.handle('credential:status', (_e, refs: string[]) => {
    const out: Record<string, boolean> = {}
    for (const ref of refs) out[ref] = hasCredential(ref)
    return out
  })

  ipcMain.handle('server:test', async (_e, serverId: string) => {
    const config = loadConfig()
    const server = config.servers.find((s) => s.id === serverId)
    if (!server) throw new Error('服务器不存在')
    return testSshConnection(server)
  })

  ipcMain.handle('server:testDraft', async (_e, server: ServerConfig, passwordOrKey: string) => {
    if (passwordOrKey) {
      setCredential(server.credentialRef, passwordOrKey)
    }
    return testSshConnection(server)
  })

  ipcMain.handle('git:listBranches', async (_e, serverId: string, repoId: string) => {
    return listRemoteBranches(serverId, repoId)
  })

  ipcMain.handle('publish:run', async (_e, task: PublishTask) => {
    return runPublishTask(task, getMainWindow)
  })

  ipcMain.handle('deploy:listImages', async (_e, packageServerId: string) => {
    return listPackageImages(packageServerId)
  })

  ipcMain.handle('deploy:checkTarget', async (_e, deployServerId: string) => {
    return checkDeployTarget(deployServerId)
  })

  ipcMain.handle('deploy:runImages', async (_e, task: ImageDeployTask) => {
    return runImageDeploy(task, getMainWindow)
  })

  ipcMain.handle('history:list', () => loadHistory())

  ipcMain.handle('id:create', () => randomUUID())

  ipcMain.handle(
    'dialog:exportJson',
    async (_e, defaultName: string, data: unknown) => {
      const win = getMainWindow()
      const result = await dialog.showSaveDialog(win ?? undefined, {
        title: '导出配置',
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: false as const }
      writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { ok: true as const, path: result.filePath }
    }
  )

  ipcMain.handle('dialog:importJson', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '导入配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false as const }
    const text = readFileSync(result.filePaths[0], 'utf-8')
    try {
      const data = JSON.parse(text) as unknown
      return { ok: true as const, data, path: result.filePaths[0] }
    } catch {
      throw new Error('JSON 解析失败')
    }
  })

  ipcMain.handle('ui:setTitleBar', (_e, theme: string) => applyWindowTheme(theme))
}
