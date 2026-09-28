import { useEffect, useState } from 'react'
import type { AppConfig, ServerConfig, ServerRole } from '../../../shared/types'
import { SERVER_ROLE_DEFAULTS, SERVER_ROLE_LABELS } from '../../../shared/types'
import Modal from '../components/Modal'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

type Draft = Omit<ServerConfig, 'id' | 'credentialRef'>

const empty = (): Draft => ({
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  role: 'package',
  rootDir: SERVER_ROLE_DEFAULTS.package.rootDir,
  deployDir: SERVER_ROLE_DEFAULTS.package.deployDir
})

function applyRoleDefaults(role: ServerRole, draft: Draft): Draft {
  const defaults = SERVER_ROLE_DEFAULTS[role]
  const prevDefaults = SERVER_ROLE_DEFAULTS[draft.role || 'package']
  const rootIsDefault =
    !draft.rootDir || draft.rootDir === prevDefaults.rootDir || draft.rootDir === defaults.rootDir
  const deployIsDefault =
    !draft.deployDir ||
    draft.deployDir === prevDefaults.deployDir ||
    draft.deployDir === defaults.deployDir
  return {
    ...draft,
    role,
    rootDir: rootIsDefault ? defaults.rootDir : draft.rootDir,
    deployDir: deployIsDefault ? defaults.deployDir : draft.deployDir
  }
}

export default function ServersPage({ config, onSave }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(empty())
  const [secret, setSecret] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [credMap, setCredMap] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refreshCred = async (): Promise<void> => {
    const refs = config.servers.map((s) => s.credentialRef)
    if (refs.length === 0) {
      setCredMap({})
      return
    }
    setCredMap(await window.api.credentialStatus(refs))
  }

  useEffect(() => {
    void refreshCred()
  }, [config.servers])

  const openCreate = (): void => {
    setEditingId(null)
    setDraft(empty())
    setSecret('')
    setMsg('')
    setOpen(true)
  }

  const openEdit = (server: ServerConfig): void => {
    setEditingId(server.id)
    setDraft({
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      role: server.role || 'package',
      rootDir: server.rootDir,
      deployDir: server.deployDir || ''
    })
    setSecret('')
    setMsg('')
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.host.trim()) {
      setMsg('请填写名称和主机')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const servers = [...config.servers]
      const normalized: Draft = {
        ...draft,
        role: draft.role || 'package',
        rootDir: draft.rootDir.trim() || SERVER_ROLE_DEFAULTS[draft.role || 'package'].rootDir,
        deployDir:
          draft.deployDir?.trim() || SERVER_ROLE_DEFAULTS[draft.role || 'package'].deployDir
      }
      if (editingId) {
        const idx = servers.findIndex((s) => s.id === editingId)
        if (idx >= 0) {
          servers[idx] = { ...servers[idx], ...normalized }
          if (secret) await window.api.setCredential(servers[idx].credentialRef, secret)
        }
      } else {
        if (!secret) {
          setMsg('新增服务器请填写密码或私钥')
          setBusy(false)
          return
        }
        const id = await window.api.createId()
        const credentialRef = `server.${id}`
        await window.api.setCredential(credentialRef, secret)
        servers.push({ id, credentialRef, ...normalized })
      }
      await onSave({ ...config, servers })
      setOpen(false)
      await refreshCred()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm('删除该服务器及其相关路径映射？')) return
    const server = config.servers.find((s) => s.id === id)
    if (server) await window.api.setCredential(server.credentialRef, '')
    const servers = config.servers.filter((s) => s.id !== id)
    const mappings = config.mappings.filter((m) => m.serverId !== id)
    await onSave({ ...config, servers, mappings })
  }

  const test = async (serverId: string): Promise<void> => {
    setBusy(true)
    try {
      const out = await window.api.testServer(serverId)
      alert(`连接成功\n${out}`)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const exportCfg = async (): Promise<void> => {
    const res = await window.api.exportJson('agent-builder-servers.json', {
      version: 1,
      kind: 'servers',
      servers: config.servers.map(({ credentialRef: _c, ...rest }) => rest)
    })
    if (res.ok) alert(`已导出（不含密码）: ${res.path}`)
  }

  const importCfg = async (): Promise<void> => {
    const res = await window.api.importJson()
    if (!res.ok) return
    const data = res.data as { servers?: Array<Partial<ServerConfig> & { id?: string }> }
    const list = Array.isArray(data) ? data : data.servers
    if (!Array.isArray(list)) {
      alert('文件格式不正确：需要 servers 数组')
      return
    }
    if (!confirm('合并导入服务器配置？（不含密码，导入后需重新填写凭证）')) return

    const map = new Map(config.servers.map((s) => [s.id, s]))
    for (const item of list) {
      if (!item?.name || !item.host) continue
      const id = item.id || (await window.api.createId())
      const prev = map.get(id)
      const role: ServerRole = item.role === 'deploy' ? 'deploy' : 'package'
      const defaults = SERVER_ROLE_DEFAULTS[role]
      map.set(id, {
        id,
        name: item.name,
        host: item.host,
        port: item.port || 22,
        username: item.username || 'root',
        authType: item.authType === 'privateKey' ? 'privateKey' : 'password',
        credentialRef: prev?.credentialRef || `server.${id}`,
        role,
        rootDir: item.rootDir || defaults.rootDir,
        deployDir: item.deployDir || defaults.deployDir
      })
    }
    await onSave({ ...config, servers: Array.from(map.values()) })
    alert('服务器配置已导入（请检查并补充密码）')
    await refreshCred()
  }

  return (
    <div>
      <h1 className="page-title">服务器管理</h1>
      <p className="page-desc">
        配置打包机 / 部署机 SSH。类型决定默认目录：打包
        <code>/home/ai_package/deploy</code>，部署 <code>/home/deploy</code>。
      </p>

      <div className="toolbar">
        <button className="btn primary" type="button" onClick={openCreate}>
          新增服务器
        </button>
        <button className="btn" type="button" onClick={() => void exportCfg()}>
          导出
        </button>
        <button className="btn" type="button" onClick={() => void importCfg()}>
          导入
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 88 }}>名称</th>
                <th style={{ width: 110, whiteSpace: 'nowrap' }}>类型</th>
                <th className="col-host">地址</th>
                <th style={{ width: 72 }}>用户</th>
                <th className="col-path-sm">deploy 目录</th>
                <th className="col-cred">凭证</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {config.servers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    暂无服务器，点击「新增服务器」
                  </td>
                </tr>
              ) : (
                config.servers.map((server) => {
                  const role = server.role || 'package'
                  return (
                    <tr key={server.id}>
                      <td>{server.name}</td>
                      <td>
                        <span className={`tag ${role === 'deploy' ? 'run' : 'ok'}`}>
                          {SERVER_ROLE_LABELS[role]}
                        </span>
                      </td>
                      <td className="col-host">
                        {server.host}:{server.port}
                      </td>
                      <td>{server.username}</td>
                      <td
                        className="col-path-sm muted"
                        title={server.deployDir || `${server.rootDir}/deploy`}
                      >
                        {server.deployDir ||
                          (role === 'deploy' ? server.rootDir : `${server.rootDir}/deploy`)}
                      </td>
                      <td className="col-cred">
                        <span className={`tag ${credMap[server.credentialRef] ? 'ok' : 'err'}`}>
                          {credMap[server.credentialRef] ? '已配置' : '缺失'}
                        </span>
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button
                            className="btn"
                            type="button"
                            disabled={busy}
                            onClick={() => void test(server.id)}
                          >
                            测连通
                          </button>
                          <button className="btn" type="button" onClick={() => openEdit(server)}>
                            编辑
                          </button>
                          <button
                            className="btn danger"
                            type="button"
                            onClick={() => void remove(server.id)}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal
          title={editingId ? '编辑服务器' : '新增服务器'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="btn primary" type="button" disabled={busy} onClick={() => void submit()}>
                {busy ? '保存中…' : '保存'}
              </button>
            </>
          }
        >
          <div className="grid-2">
            <div className="field">
              <label>名称</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="field">
              <label>服务器类型</label>
              <select
                value={draft.role || 'package'}
                onChange={(e) =>
                  setDraft(applyRoleDefaults(e.target.value as ServerRole, draft))
                }
              >
                <option value="package">{SERVER_ROLE_LABELS.package}</option>
                <option value="deploy">{SERVER_ROLE_LABELS.deploy}</option>
              </select>
            </div>
            <div className="field">
              <label>主机</label>
              <input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
            </div>
            <div className="field">
              <label>端口</label>
              <input
                type="number"
                value={draft.port}
                onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) || 22 })}
              />
            </div>
            <div className="field">
              <label>用户名</label>
              <input
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </div>
            <div className="field">
              <label>认证方式</label>
              <select
                value={draft.authType}
                onChange={(e) =>
                  setDraft({ ...draft, authType: e.target.value as ServerConfig['authType'] })
                }
              >
                <option value="password">密码</option>
                <option value="privateKey">SSH 私钥</option>
              </select>
            </div>
            <div className="field">
              <label>远程根目录</label>
              <input
                value={draft.rootDir}
                onChange={(e) => setDraft({ ...draft, rootDir: e.target.value })}
              />
            </div>
            <div className="field">
              <label>deploy 目录</label>
              <input
                value={draft.deployDir || ''}
                onChange={(e) => setDraft({ ...draft, deployDir: e.target.value })}
                placeholder={
                  draft.role === 'deploy' ? '/home/deploy' : '/home/ai_package/deploy'
                }
              />
            </div>
          </div>
          <div className="field">
            <label>
              {draft.authType === 'password' ? '密码' : '私钥内容'}
              {editingId ? '（留空表示不修改）' : ''}
            </label>
            {draft.authType === 'password' ? (
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
              />
            ) : (
              <textarea value={secret} onChange={(e) => setSecret(e.target.value)} />
            )}
          </div>
          {msg && <p style={{ color: 'var(--err)' }}>{msg}</p>}
        </Modal>
      )}
    </div>
  )
}
