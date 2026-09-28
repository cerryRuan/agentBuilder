import { useState } from 'react'
import type { AppConfig, MappingConfig } from '../../../shared/types'
import Modal from '../components/Modal'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

export default function MappingsPage({ config, onSave }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [repoId, setRepoId] = useState(config.repos[0]?.id || '')
  const [serverId, setServerId] = useState(config.servers[0]?.id || '')
  const [remotePath, setRemotePath] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const repoName = (id: string): string => config.repos.find((r) => r.id === id)?.name || id
  const serverName = (id: string): string => config.servers.find((s) => s.id === id)?.name || id

  const openCreate = (): void => {
    setEditingId(null)
    setRepoId(config.repos[0]?.id || '')
    setServerId(config.servers[0]?.id || '')
    setRemotePath('')
    setMsg('')
    setOpen(true)
  }

  const openEdit = (m: MappingConfig): void => {
    setEditingId(m.id)
    setRepoId(m.repoId)
    setServerId(m.serverId)
    setRemotePath(m.remotePath)
    setMsg('')
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    if (!repoId || !serverId || !remotePath.trim()) {
      setMsg('请选择仓库、服务器并填写远程路径')
      return
    }
    const path = remotePath.trim()
    const mappings = [...config.mappings]
    const dup = mappings.find(
      (m) => m.repoId === repoId && m.serverId === serverId && m.id !== editingId
    )
    if (dup) {
      setMsg('该仓库在此服务器上已有映射')
      return
    }

    setBusy(true)
    try {
      if (editingId) {
        const idx = mappings.findIndex((m) => m.id === editingId)
        if (idx >= 0) mappings[idx] = { ...mappings[idx], repoId, serverId, remotePath: path }
      } else {
        const id = await window.api.createId()
        mappings.push({ id, repoId, serverId, remotePath: path })
      }
      await onSave({ ...config, mappings })
      setOpen(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm('删除该映射？')) return
    await onSave({ ...config, mappings: config.mappings.filter((m) => m.id !== id) })
  }

  const exportCfg = async (): Promise<void> => {
    const res = await window.api.exportJson('agent-builder-mappings.json', {
      version: 1,
      kind: 'mappings',
      mappings: config.mappings
    })
    if (res.ok) alert(`已导出: ${res.path}`)
  }

  const importCfg = async (): Promise<void> => {
    const res = await window.api.importJson()
    if (!res.ok) return
    const data = res.data as { mappings?: MappingConfig[] }
    const list = Array.isArray(data) ? (data as MappingConfig[]) : data.mappings
    if (!Array.isArray(list)) {
      alert('文件格式不正确：需要 mappings 数组')
      return
    }
    if (!confirm('合并导入路径映射？')) return
    const map = new Map(config.mappings.map((m) => [m.id, m]))
    for (const item of list) {
      if (!item?.repoId || !item.serverId || !item.remotePath) continue
      const id = item.id || (await window.api.createId())
      map.set(id, {
        id,
        repoId: item.repoId,
        serverId: item.serverId,
        remotePath: item.remotePath
      })
    }
    await onSave({ ...config, mappings: [...map.values()] })
    alert('路径映射已导入（合并）')
  }

  return (
    <div>
      <h1 className="page-title">路径映射</h1>
      <p className="page-desc">指定仓库同步到服务器的哪个目录。新增/编辑使用弹窗。</p>

      <div className="toolbar">
        <button className="btn primary" type="button" onClick={openCreate}>
          新增映射
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
                <th>仓库</th>
                <th style={{ width: 100 }}>服务器</th>
                <th>远程路径</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {config.mappings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    暂无映射，点击「新增映射」
                  </td>
                </tr>
              ) : (
                config.mappings.map((m) => (
                  <tr key={m.id}>
                    <td>{repoName(m.repoId)}</td>
                    <td>{serverName(m.serverId)}</td>
                    <td className="cell-wrap muted">{m.remotePath}</td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="btn" type="button" onClick={() => openEdit(m)}>
                          编辑
                        </button>
                        <button className="btn danger" type="button" onClick={() => void remove(m.id)}>
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal
          title={editingId ? '编辑映射' : '新增映射'}
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
          <div className="field">
            <label>仓库</label>
            <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
              <option value="">请选择</option>
              {config.repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>服务器</label>
            <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
              <option value="">请选择</option>
              {config.servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>远程目录（绝对路径）</label>
            <input
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder="/home/ai_package/yb-agent-web"
            />
          </div>
          {msg && <p style={{ color: 'var(--err)' }}>{msg}</p>}
        </Modal>
      )}
    </div>
  )
}
