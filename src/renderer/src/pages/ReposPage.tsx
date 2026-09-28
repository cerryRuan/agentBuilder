import { useState } from 'react'
import type { AppConfig, BuildRole, RepoConfig } from '../../../shared/types'
import { BUILD_ROLE_LABELS } from '../../../shared/types'
import Modal from '../components/Modal'

interface Props {
  config: AppConfig
  onSave: (config: AppConfig) => Promise<void>
}

const empty = (): Omit<RepoConfig, 'id'> => ({
  name: '',
  gitUrl: '',
  defaultBranch: 'main',
  enabled: true,
  buildRole: 'none'
})

const ROLE_OPTIONS: BuildRole[] = ['none', 'web', 'h5', 'java', 'python']

export default function ReposPage({ config, onSave }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(empty())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const openCreate = (): void => {
    setEditingId(null)
    setDraft(empty())
    setMsg('')
    setOpen(true)
  }

  const openEdit = (repo: RepoConfig): void => {
    setEditingId(repo.id)
    setDraft({
      name: repo.name,
      gitUrl: repo.gitUrl,
      defaultBranch: repo.defaultBranch,
      enabled: repo.enabled,
      buildRole: repo.buildRole || 'none'
    })
    setMsg('')
    setOpen(true)
  }

  const submit = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.gitUrl.trim()) {
      setMsg('请填写名称和 Git URL')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const repos = [...config.repos]
      if (editingId) {
        const idx = repos.findIndex((r) => r.id === editingId)
        if (idx >= 0) repos[idx] = { ...repos[idx], ...draft }
      } else {
        const id = await window.api.createId()
        repos.push({ id, ...draft })
      }
      await onSave({ ...config, repos })
      setOpen(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm('删除该仓库及其相关路径映射？')) return
    const repos = config.repos.filter((r) => r.id !== id)
    const mappings = config.mappings.filter((m) => m.repoId !== id)
    await onSave({ ...config, repos, mappings })
  }

  const exportCfg = async (): Promise<void> => {
    const res = await window.api.exportJson('agent-builder-repos.json', {
      version: 1,
      kind: 'repos',
      repos: config.repos
    })
    if (res.ok) alert(`已导出: ${res.path}`)
  }

  const importCfg = async (): Promise<void> => {
    const res = await window.api.importJson()
    if (!res.ok) return
    const data = res.data as { repos?: RepoConfig[]; kind?: string }
    const list = Array.isArray(data) ? (data as RepoConfig[]) : data.repos
    if (!Array.isArray(list)) {
      alert('文件格式不正确：需要 repos 数组')
      return
    }
    const mode = confirm('确定导入？\n确定 = 合并（同 id 覆盖）\n取消后再选「替换全部」可点下方逻辑…\n\n点确定执行合并导入。')
    if (!mode) return

    const map = new Map(config.repos.map((r) => [r.id, r]))
    for (const item of list) {
      if (!item?.id || !item.name || !item.gitUrl) continue
      map.set(item.id, {
        id: item.id,
        name: item.name,
        gitUrl: item.gitUrl,
        defaultBranch: item.defaultBranch || 'main',
        enabled: item.enabled !== false,
        buildRole: item.buildRole || 'none'
      })
    }
    await onSave({ ...config, repos: [...map.values()] })
    alert('仓库配置已导入（合并）')
  }

  return (
    <div>
      <h1 className="page-title">仓库管理</h1>
      <p className="page-desc">管理 Git 仓库与构建角色。新增/编辑请使用弹窗。</p>

      <div className="toolbar">
        <button className="btn primary" type="button" onClick={openCreate}>
          新增仓库
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
                <th>名称</th>
                <th>Git URL</th>
                <th style={{ width: 100 }}>默认分支</th>
                <th style={{ width: 200 }}>构建角色</th>
                <th style={{ width: 72 }}>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {config.repos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    暂无仓库，点击「新增仓库」
                  </td>
                </tr>
              ) : (
                config.repos.map((repo) => (
                  <tr key={repo.id}>
                    <td>{repo.name}</td>
                    <td className="cell-wrap muted">{repo.gitUrl}</td>
                    <td>{repo.defaultBranch}</td>
                    <td className="cell-wrap">{BUILD_ROLE_LABELS[repo.buildRole || 'none']}</td>
                    <td>
                      <span className={`tag ${repo.enabled ? 'ok' : ''}`}>
                        {repo.enabled ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button className="btn" type="button" onClick={() => openEdit(repo)}>
                          编辑
                        </button>
                        <button className="btn danger" type="button" onClick={() => void remove(repo.id)}>
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
          title={editingId ? '编辑仓库' : '新增仓库'}
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
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="前端 Web"
              />
            </div>
            <div className="field">
              <label>默认分支</label>
              <input
                value={draft.defaultBranch}
                onChange={(e) => setDraft({ ...draft, defaultBranch: e.target.value })}
                placeholder="main"
              />
            </div>
          </div>
          <div className="field">
            <label>Git URL</label>
            <input
              value={draft.gitUrl}
              onChange={(e) => setDraft({ ...draft, gitUrl: e.target.value })}
              placeholder="https://git.xxx.com/group/yb-agent-web.git"
            />
          </div>
          <div className="field">
            <label>构建角色</label>
            <select
              value={draft.buildRole}
              onChange={(e) => setDraft({ ...draft, buildRole: e.target.value as BuildRole })}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {BUILD_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <label className="check-inline field">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            启用（关闭后不出现在发布勾选列表）
          </label>
          {msg && <p className="muted" style={{ color: 'var(--err)' }}>{msg}</p>}
        </Modal>
      )}
    </div>
  )
}
