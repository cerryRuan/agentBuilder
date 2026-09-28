import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { applyWindowTheme, registerIpc, setMainWindowGetter } from './ipc'
import { loadConfig } from './store'
import { THEME_TITLEBAR, type AppTheme } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function resolveTheme(): AppTheme {
  try {
    return (loadConfig().ui?.theme || 'deep-blue') as AppTheme
  } catch (err) {
    console.error('[createWindow] loadConfig failed, fallback theme', err)
    return 'deep-blue'
  }
}

function createWindow(): void {
  Menu.setApplicationMenu(null)

  const savedTheme = resolveTheme()
  const palette = THEME_TITLEBAR[savedTheme] || THEME_TITLEBAR['deep-blue']

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'Agent Builder',
    backgroundColor: palette.background,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: palette.overlay,
      symbolColor: palette.symbol,
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.setMenuBarVisibility(false)

  let revealed = false
  const reveal = (reason: string): void => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return
    revealed = true
    try {
      applyWindowTheme(savedTheme)
    } catch (err) {
      console.error('[reveal] applyWindowTheme failed', err)
    }
    mainWindow.show()
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    console.log(`[reveal] window shown (${reason})`)
  }

  mainWindow.on('ready-to-show', () => reveal('ready-to-show'))

  // 部分环境下 ready-to-show 不可靠，加载完成后再兜底一次
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => reveal('did-finish-load'), 50)
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
    // 仍尝试显示，避免一直卡在无窗口状态
    setTimeout(() => reveal('did-fail-load'), 50)
  })

  // 最终兜底：3s 内必显
  setTimeout(() => reveal('timeout'), 3000)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    console.log('[createWindow] loadURL', rendererUrl)
    void mainWindow.loadURL(rendererUrl)
  } else {
    const file = join(__dirname, '../renderer/index.html')
    console.log('[createWindow] loadFile', file)
    void mainWindow.loadFile(file)
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// 防止多次 npm run dev 起多个实例，导致缓存锁/看起来「没唤起」
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('[startup] another instance is running, quit this one')
  app.quit()
} else {
  app.on('second-instance', () => {
    console.log('[startup] second-instance → focus existing window')
    focusMainWindow()
  })

  app.whenReady().then(() => {
    app.setName('Agent Builder')
    registerIpc()
    setMainWindowGetter(() => mainWindow)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else focusMainWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
