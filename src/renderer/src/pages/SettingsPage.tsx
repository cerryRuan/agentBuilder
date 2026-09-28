import { useEffect, useState } from 'react'
import type { AppConfig } from '../../../shared/types'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

export default function SettingsPage({ config, onSave }: Props): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(config.git.baseUrl)
  const [authType, setAuthType] = useState(config.git.authType)
  const [username, setUsername] = useState(config.git.username)
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [hasCred, setHasCred] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    setBaseUrl(config.git.baseUrl)
    setAuthType(config.git.authType)
    setUsername(config.git.username)
    setShowSecret(false)
    void (async () => {
      const value = await window.api.getCredential(config.git.credentialRef)
      setSecret(value)
      setHasCred(Boolean(value))
    })()
  }, [config.git])

  const save = async (): Promise<void> => {
    await onSave({
      ...config,
      git: {
        ...config.git,
        baseUrl: baseUrl.trim(),
        authType,
        username: username.trim()
      }
    })
    await window.api.setCredential(config.git.credentialRef, secret)
    setHasCred(Boolean(secret.trim()))
    setMsg('已保存。同步时会用此凭证在本地拉取 Git，再上传覆盖到服务器。')
  }

  return (
    <div>
      <h1 className="page-title">Git 认证</h1>
      <p className="page-desc">
        本机拉取仓库分支时使用。请配置内网 Git 的 Token 或账号密码（HTTPS）。
      </p>

      <div className="card">
        <div className="field">
          <label>Git 服务器地址</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://git.xxx.com"
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>认证方式</label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value as AppConfig['git']['authType'])}
            >
              <option value="token">Token</option>
              <option value="password">用户名密码</option>
            </select>
          </div>
          <div className="field">
            <label>用户名</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>{authType === 'token' ? 'Token' : '密码'}</label>
          <div className="password-field">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="new-password"
              placeholder={authType === 'token' ? '请输入 Token' : '请输入密码'}
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={showSecret ? '隐藏' : '显示'}
              title={showSecret ? '隐藏' : '显示'}
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn primary" type="button" onClick={() => void save()}>
            保存
          </button>
          <span className={`tag ${hasCred ? 'ok' : 'err'}`}>
            {hasCred ? '凭证已配置' : '凭证未配置'}
          </span>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
