import { useEffect, useMemo, useState } from 'react'
import type { AppConfig, PublishMode, SyncLogEvent } from '../../../shared/types'
import { BUILD_ROLE_LABELS } from '../../../shared/types'
import LogViewer from '../components/LogViewer'
import { useReportRunning, useTaskSession } from '../task-session'

interface Props {
  config: AppConfig
}

interface RowState {
  repoId: string
  selected: boolean
  branch: string
  branches: string[]
  loadingBranches: boolean
}

export default function PublishPage({ config }: Props): React.JSX.Element {
  const packageServers = useMemo(
    () => config.servers.filter((s) => (s.role || 'package') === 'package'),
    [config.servers]
  )
  const [serverId, setServerId] = useState(packageServers[0]?.id || '')
  const [mode, setMode] = useState<PublishMode>('sync-and-deploy')
  const [packImages, setPackImages] = useState(true)
  const [rows, setRows] = useState<RowState[]>([])
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<SyncLogEvent[]>([])
  const { anyRunning } = useTaskSession()
  useReportRunning('publish', running)

  useEffect(() => {
    if (serverId && !packageServers.some((s) => s.id === serverId)) {
      setServerId(packageServers[0]?.id || '')
    } else if (!serverId && packageServers[0]) {
      setServerId(packageServers[0].id)
    }
  }, [packageServers, serverId])

  const mappedRepos = useMemo(() => {
    return config.repos.filter(
      (r) =>
        r.enabled &&
        config.mappings.some((m) => m.serverId === serverId && m.repoId === r.id)
    )
  }, [config, serverId])

  const deployPlan = useMemo(() => {
    const selected = rows.filter((r) => r.selected)
    const roles = new Set(
      selected
        .map((r) => config.repos.find((x) => x.id === r.repoId)?.buildRole || 'none')
        .filter((role) => role !== 'none')
    )
    const services: string[] = []
    if (roles.has('web') || roles.has('h5')) services.push('frontend')
    if (roles.has('java')) services.push('java-backend')
    if (roles.has('python')) services.push('python-agent')
    return { roles: [...roles], services }
  }, [rows, config.repos])

  useEffect(() => {
    const initial = mappedRepos.map((r) => ({
      repoId: r.id,
      selected: false,
      branch: r.defaultBranch || 'main',
      branches: r.defaultBranch ? [r.defaultBranch] : ['main'],
      loadingBranches: Boolean(serverId)
    }))
    setRows(initial)

    if (!serverId || mappedRepos.length === 0) return

    let cancelled = false
    const repoIds = mappedRepos.map((r) => r.id)

    void (async () => {
      await Promise.all(
        repoIds.map(async (repoId) => {
          try {
            const branches = await window.api.listBranches(serverId, repoId)
            if (cancelled) return
            setRows((prev) =>
              prev.map((r) => {
                if (r.repoId !== repoId) return r
                const nextBranches = branches.length ? branches : r.branches
                const fallback =
                  nextBranches.find((b) => b === r.branch) ||
                  nextBranches.find((b) => b === 'main' || b === 'master') ||
                  nextBranches[0] ||
                  r.branch
                return {
                  ...r,
                  branches: nextBranches,
                  branch: fallback,
                  loadingBranches: false
                }
              })
            )
          } catch (e) {
            if (cancelled) return
            setLogs((prev) => [
              ...prev,
              {
                level: 'warn',
                message: `拉取分支失败（${repoId}）: ${e instanceof Error ? e.message : String(e)}`,
                ts: new Date().toISOString()
              }
            ])
            setRows((prev) =>
              prev.map((row) =>
                row.repoId === repoId ? { ...row, loadingBranches: false } : row
              )
            )
          }
        })
      )
    })()

    return () => {
      cancelled = true
    }
  }, [serverId, mappedRepos])

  useEffect(() => {
    const off = window.api.onSyncLog((event) => {
      if (event.channel && event.channel !== 'publish') return
      setLogs((prev) => [...prev, event])
    })
    return off
  }, [])

  const logLines = useMemo(
    () =>
      logs.map((l, i) => ({
        id: `${l.ts}-${i}`,
        className: `log-${l.level}`,
        text: `[${new Date(l.ts).toLocaleTimeString()}] ${l.message}`
      })),
    [logs]
  )

  const logCopyText = useMemo(
    () =>
      logs
        .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] [${l.level}] ${l.message}`)
        .join('\n'),
    [logs]
  )

  const pathOf = (repoId: string): string =>
    config.mappings.find((m) => m.serverId === serverId && m.repoId === repoId)?.remotePath || '-'

  const loadBranches = async (repoId: string): Promise<void> => {
    if (!serverId) return
    setRows((prev) =>
      prev.map((r) => (r.repoId === repoId ? { ...r, loadingBranches: true } : r))
    )
    try {
      const branches = await window.api.listBranches(serverId, repoId)
      setRows((prev) =>
        prev.map((r) =>
          r.repoId === repoId
            ? {
                ...r,
                branches: branches.length ? branches : r.branches,
                branch: branches.includes(r.branch) ? r.branch : branches[0] || r.branch,
                loadingBranches: false
              }
            : r
        )
      )
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        {
          level: 'error',
          message: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString()
        }
      ])
      setRows((prev) =>
        prev.map((r) => (r.repoId === repoId ? { ...r, loadingBranches: false } : r))
      )
    }
  }

  const allSelected = rows.length > 0 && rows.every((r) => r.selected)

  const toggleAll = (selected: boolean): void => {
    setRows((prev) => prev.map((r) => ({ ...r, selected })))
  }

  const run = async (): Promise<void> => {
    if (anyRunning) {
      alert('已有任务进行中，请等待完成后再开始')
      return
    }
    if (!serverId) {
      alert('请先选择服务器')
      return
    }
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0) {
      alert('请至少勾选一个仓库')
      return
    }
    const invalid = selected.find((r) => r.branches.length > 0 && !r.branches.includes(r.branch))
    if (invalid) {
      const name = config.repos.find((x) => x.id === invalid.repoId)?.name || invalid.repoId
      alert(`仓库「${name}」没有分支「${invalid.branch}」，请先点「刷新」并重新选择分支`)
      return
    }
    if (mode === 'sync-and-deploy' && deployPlan.roles.length === 0) {
      const ok = confirm(
        '所选仓库构建角色均为「仅上传」。将只上传不构建部署，是否继续？'
      )
      if (!ok) return
    }
    setRunning(true)
    setLogs([])
    try {
      const result = await window.api.runPublish({
        serverId,
        mode,
        packImages: mode === 'sync-and-deploy' ? packImages : false,
        items: rows.map((r) => ({
          repoId: r.repoId,
          branch: r.branch,
          selected: r.selected
        }))
      })
      if (result.status === 'failed') {
        setLogs((prev) => [
          ...prev,
          {
            level: 'error',
            message: '任务结束：失败（详见上方日志）',
            ts: new Date().toISOString()
          }
        ])
      } else {
        setLogs((prev) => [
          ...prev,
          {
            level: 'success',
            message: '任务结束：成功',
            ts: new Date().toISOString()
          }
        ])
      }
    } catch (e) {
      setLogs((prev) => [
        ...prev,
        {
          level: 'error',
          message: e instanceof Error ? e.message : String(e),
          ts: new Date().toISOString()
        }
      ])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">发布同步</h1>
      <p className="page-desc">
        本机拉取 Git → 上传覆盖映射目录；可选继续在服务器执行 build 脚本并重建/重启容器。
      </p>

      <div className="card">
        <div className="grid-2">
          <div className="field">
            <label>目标服务器</label>
            <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
              <option value="">请选择</option>
              {packageServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>模式</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as PublishMode)}>
              <option value="sync-only">仅上传覆盖</option>
              <option value="sync-and-deploy">上传并构建部署</option>
            </select>
          </div>
        </div>

        {mode === 'sync-and-deploy' && (
          <>
            <label className="check-inline" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={packImages}
                onChange={(e) => setPackImages(e.target.checked)}
                disabled={running}
              />
              构建部署后打包镜像（导出到打包机 deploy/images，供「服务部署」使用）
            </label>
          </>
        )}

        <div className="toolbar">
          <button
            className="btn"
            type="button"
            disabled={rows.length === 0}
            onClick={() => toggleAll(!allSelected)}
          >
            {allSelected ? '全不选' : '全选'}
          </button>
          <button className="btn primary" type="button" disabled={running || anyRunning} onClick={() => void run()}>
            {running ? '执行中…' : mode === 'sync-and-deploy' ? '开始上传并部署' : '开始上传'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-check">勾选</th>
                <th style={{ width: 140 }}>仓库</th>
                <th style={{ width: 180 }}>构建角色</th>
                <th style={{ width: 140 }}>分支</th>
                <th>远程路径</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    当前服务器下没有可用映射。请先在「仓库 / 服务器 / 路径映射」中配置。
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const repo = config.repos.find((r) => r.id === row.repoId)
                  return (
                    <tr key={row.repoId}>
                      <td className="col-check">
                        <label className="check-inline" style={{ justifyContent: 'center' }}>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.repoId === row.repoId ? { ...r, selected: e.target.checked } : r
                                )
                              )
                            }
                          />
                        </label>
                      </td>
                      <td>{repo?.name}</td>
                      <td className="cell-wrap muted">
                        {BUILD_ROLE_LABELS[repo?.buildRole || 'none']}
                      </td>
                      <td>
                        <select
                          value={row.branch}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.repoId === row.repoId ? { ...r, branch: e.target.value } : r
                              )
                            )
                          }
                        >
                          {row.branches.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="cell-wrap muted">{pathOf(row.repoId)}</td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button
                            className="btn"
                            type="button"
                            disabled={row.loadingBranches || running}
                            onClick={() => void loadBranches(row.repoId)}
                          >
                            {row.loadingBranches ? '…' : '刷新'}
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

      <div className="card">
        <LogViewer
          lines={logLines}
          copyText={logCopyText}
          emptyText="等待任务…"
          running={running}
        />
      </div>
    </div>
  )
}
