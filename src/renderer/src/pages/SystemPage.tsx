import { useState } from 'react'
import type { AppConfig, AppTheme } from '../../../shared/types'
import { THEME_LABELS } from '../../../shared/types'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

const THEMES: AppTheme[] = ['deep-blue', 'midnight', 'ocean', 'light']

export default function SystemPage({ config, onSave }: Props): React.JSX.Element {
  const [theme, setTheme] = useState<AppTheme>(config.ui?.theme || 'deep-blue')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      await onSave({
        ...config,
        ui: {
          ...config.ui,
          theme
        }
      })
      setMsg('已保存')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">系统配置</h1>
      <p className="page-desc">全局界面与偏好设置，立即作用于本机应用。</p>

      <div className="card">
        <h3>主题</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
          保持深蓝基调，可微调明暗。选择后点保存生效并持久化。
        </p>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              className={`theme-card ${theme === t ? 'active' : ''}`}
              onClick={() => {
                setTheme(t)
                document.documentElement.setAttribute('data-theme', t)
                void window.api.setTitleBarTheme(t)
              }}
            >
              <div className={`theme-preview theme-preview-${t}`} />
              <div className="theme-card-label">{THEME_LABELS[t]}</div>
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存主题'}
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <h3>说明</h3>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Git 账号请到「Git 认证」配置</li>
          <li>仓库 / 服务器 / 路径映射支持各自页面的导入导出</li>
          <li>主题仅影响本机界面，不影响远程打包环境</li>
        </ul>
      </div>
    </div>
  )
}
