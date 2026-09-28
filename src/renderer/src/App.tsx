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

type NavIcon =
  | 'rocket'
  | 'deploy'
  | 'key'
  | 'server'
  | 'repo'
  | 'map'
  | 'history'
  | 'gear'
  | 'guide'

const NAV_SECTIONS: {
  title: string
  items: { id: Tab; label: string; icon: NavIcon }[]
}[] = [
  {
    title: '工作流',
    items: [
      { id: 'publish', label: '发布', icon: 'rocket' },
      { id: 'service-deploy', label: '服务部署', icon: 'deploy' }
    ]
  },
  {
    title: '接入配置',
    items: [
      { id: 'settings', label: 'Git 认证', icon: 'key' },
      { id: 'servers', label: '服务器', icon: 'server' },
      { id: 'repos', label: '仓库', icon: 'repo' },
      { id: 'mappings', label: '路径映射', icon: 'map' }
    ]
  },
  {
    title: '系统',
    items: [
      { id: 'history', label: '历史', icon: 'history' },
      { id: 'system', label: '系统配置', icon: 'gear' },
      { id: 'guide', label: '使用说明', icon: 'guide' }
    ]
  }
]

function NavGlyph({ icon }: { icon: NavIcon }): React.JSX.Element {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }
  switch (icon) {
    case 'rocket':
      return (
        <svg {...common}>
          <path d="M12 3c3 3 5 7 5 11a5 5 0 01-10 0c0-4 2-8 5-11z" />
          <path d="M9 14l-3 5M15 14l3 5M10 17h4" />
          <circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'deploy':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <path d="M7 7h.01M7 17h.01M12 7h5M12 17h5" />
        </svg>
      )
    case 'key':
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="3.5" />
          <path d="M11.5 12H20v3M16 12v3" />
        </svg>
      )
    case 'server':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="7" rx="1.5" />
          <rect x="4" y="14" width="16" height="7" rx="1.5" />
          <path d="M8 6.5h.01M8 17.5h.01" />
        </svg>
      )
    case 'repo':
      return (
        <svg {...common}>
          <path d="M6 4h9a3 3 0 013 3v13l-4-2-4 2-4-2V7a3 3 0 013-3z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      )
    case 'map':
      return (
        <svg {...common}>
          <path d="M9 4l6 2 5-2v16l-5 2-6-2-5 2V6l5-2z" />
          <path d="M9 4v16M15 6v16" />
        </svg>
      )
    case 'history':
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 118-8" />
          <path d="M4 4v5h5M12 8v4l3 2" />
        </svg>
      )
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M4.9 6.5l1.6 1.6M17.5 17.9l1.6 1.6M3 12h2.2M18.8 12H21M4.9 17.5l1.6-1.6M17.5 6.1l1.6-1.6" />
        </svg>
      )
    case 'guide':
      return (
        <svg {...common}>
          <path d="M5 5h8a3 3 0 013 3v11H8a3 3 0 00-3 3V5z" />
          <path d="M16 5h3a2 2 0 012 2v12a3 3 0 00-3-3h-2" />
        </svg>
      )
    default: {
      const _exhaustive: never = icon
      return _exhaustive
    }
  }
}

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
      applyTheme(cfg.ui?.theme || 'ocean')
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
    applyTheme(saved.ui?.theme || 'ocean')
  }

  const ready = !loading && !error

  return (
    <>
      <div className="titlebar-drag">
        <span className="titlebar-mark" aria-hidden />
        <strong>Agent Builder</strong>
        <span className="titlebar-sub">打包同步工具</span>
      </div>
      <div className="titlebar-divider" aria-hidden />
      <div className="app">
        <aside className="sidebar">
          {/* <div className="sidebar-brand">
            <div className="sidebar-brand-mark" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-title">Agent Console</div>
              <div className="sidebar-brand-sub">Build · Sync · Deploy</div>
            </div>
          </div> */}

          <nav className="sidebar-nav">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="nav-section">
                <div className="nav-section-title">{section.title}</div>
                <div className="nav-section-items">
                  {section.items.map((t) => {
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
                        <span className="nav-btn-icon">
                          <NavGlyph icon={t.icon} />
                        </span>
                        <span className="nav-btn-label">{t.label}</span>
                        {busy && <span className="nav-busy-dot" title="任务进行中" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <span className="sidebar-status-dot" aria-hidden />
            <span>本地就绪</span>
          </div>
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
