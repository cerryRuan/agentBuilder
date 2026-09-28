import { useCallback, useEffect, useState } from 'react'
import type { AppConfig, AppTheme } from '../../shared/types'
import { DEFAULT_CONFIG } from '../../shared/types'
import ReposPage from './pages/ReposPage'
import ServersPage from './pages/ServersPage'
import MappingsPage from './pages/MappingsPage'
import PublishPage from './pages/PublishPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import SystemPage from './pages/SystemPage'
import GuidePage from './pages/GuidePage'
import ServiceDeployPage from './pages/ServiceDeployPage'
import { TaskSessionProvider, useTaskSession } from './task-session'

type Tab =
  | 'publish'
  | 'service-deploy'
  | 'repos'
  | 'servers'
  | 'mappings'
  | 'history'
  | 'settings'
  | 'system'
  | 'guide'

const TABS: { id: Tab; label: string }[] = [
  { id: 'publish', label: '发布' },
  { id: 'service-deploy', label: '服务部署' },
  { id: 'settings', label: 'Git 认证' },
  { id: 'servers', label: '服务器' },
  { id: 'repos', label: '仓库' },
  { id: 'mappings', label: '路径映射' },
  { id: 'history', label: '历史' },
  { id: 'system', label: '系统配置' },
  { id: 'guide', label: '使用说明' }
]

function applyTheme(theme: AppTheme): void {
  document.documentElement.setAttribute('data-theme', theme)
  void window.api.setTitleBarTheme?.(theme)
}

function AppShell(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('publish')
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { publishRunning, deployRunning } = useTaskSession()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const cfg = await window.api.getConfig()
      setConfig(cfg)
      applyTheme(cfg.ui?.theme || 'deep-blue')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async (next: AppConfig): Promise<void> => {
    const saved = await window.api.saveConfig(next)
    setConfig(saved)
    applyTheme(saved.ui?.theme || 'deep-blue')
  }

  const ready = !loading && !error

  return (
    <>
      <div className="titlebar-drag">
        <strong>Agent Builder</strong>
        <span>打包同步工具</span>
      </div>
      <div className="titlebar-divider" aria-hidden />
      <div className="app">
        <aside className="sidebar">
          <div className="brand">导航</div>
          {TABS.map((t) => {
            const busy =
              (t.id === 'publish' && publishRunning) ||
              (t.id === 'service-deploy' && deployRunning)
            return (
              <button
                key={t.id}
                className={`nav-btn ${tab === t.id ? 'active' : ''} ${busy ? 'busy' : ''}`}
                onClick={() => setTab(t.id)}
                type="button"
              >
                <span>{t.label}</span>
                {busy && <span className="nav-busy-dot" title="任务进行中" />}
              </button>
            )
          })}
        </aside>
        <main className="main">
          {loading ? (
            <div className="empty">加载配置中…</div>
          ) : error ? (
            <div className="empty" style={{ color: 'var(--err)' }}>
              {error}
            </div>
          ) : null}

          {/* 发布 / 服务部署常驻挂载，切走路由不丢日志与表单 */}
          {ready && (
            <>
              <div className={tab === 'publish' ? 'page-pane' : 'page-pane hidden'}>
                <PublishPage config={config} />
              </div>
              <div className={tab === 'service-deploy' ? 'page-pane' : 'page-pane hidden'}>
                <ServiceDeployPage config={config} />
              </div>
              {tab === 'repos' && <ReposPage config={config} onSave={save} />}
              {tab === 'servers' && <ServersPage config={config} onSave={save} />}
              {tab === 'mappings' && <MappingsPage config={config} onSave={save} />}
              {tab === 'history' && <HistoryPage />}
              {tab === 'settings' && <SettingsPage config={config} onSave={save} />}
              {tab === 'system' && <SystemPage config={config} onSave={save} />}
              {tab === 'guide' && <GuidePage />}
            </>
          )}
        </main>
      </div>
    </>
  )
}

export default function App(): React.JSX.Element {
  return (
    <TaskSessionProvider>
      <AppShell />
    </TaskSessionProvider>
  )
}
