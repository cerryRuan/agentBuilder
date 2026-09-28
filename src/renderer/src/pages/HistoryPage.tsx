import { useEffect, useMemo, useState } from 'react'
import type { HistoryMode, HistoryRecord } from '../../../shared/types'
import { HISTORY_MODE_LABELS, historyModeKind } from '../../../shared/types'
import LogViewer from '../components/LogViewer'
import Modal from '../components/Modal'

type LogLevel = 'info' | 'success' | 'warn' | 'error'
type KindFilter = 'all' | 'publish' | 'image-deploy'

function parseLogTail(logTail: string): Array<{ level: LogLevel; text: string }> {
  if (!logTail.trim()) return []
  return logTail.split('\n').map((line) => {
    const m = line.match(/^\[(info|success|warn|error)\]\s?(.*)$/)
    if (m) return { level: m[1] as LogLevel, text: m[2] }
    return { level: 'info' as LogLevel, text: line }
  })
}

function modeLabel(mode: HistoryMode | string): string {
  return HISTORY_MODE_LABELS[mode as HistoryMode] || String(mode)
}

export default function HistoryPage(): React.JSX.Element {
  const [list, setList] = useState<HistoryRecord[]>([])
  const [active, setActive] = useState<HistoryRecord | null>(null)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  const refresh = async (): Promise<void> => {
    setList(await window.api.listHistory())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(() => {
    if (kindFilter === 'all') return list
    return list.filter((h) => historyModeKind(h.mode) === kindFilter)
  }, [list, kindFilter])

  const logLines = useMemo(() => {
    if (!active) return []
    return parseLogTail(active.logTail || '').map((l, i) => ({
      id: `${i}-${l.text.slice(0, 24)}`,
      className: `log-${l.level}`,
      text: l.text
    }))
  }, [active])

  return (
    <div>
      <h1 className="page-title">历史记录</h1>
      <p className="page-desc">最近 100 次任务（发布 / 服务部署）。</p>
      <div className="toolbar">
        <div className="history-filter" role="group" aria-label="任务类型">
          {(
            [
              ['all', '全部'],
              ['publish', '发布'],
              ['image-deploy', '服务部署']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${kindFilter === id ? 'primary' : ''}`}
              onClick={() => setKindFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>服务器</th>
                <th>条目</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    暂无记录
                  </td>
                </tr>
              ) : (
                filtered.map((h) => {
                  const kind = historyModeKind(h.mode)
                  return (
                    <tr key={h.id}>
                      <td>{new Date(h.startedAt).toLocaleString()}</td>
                      <td>
                        <span className={`tag ${kind === 'image-deploy' ? 'run' : 'ok'}`}>
                          {modeLabel(h.mode)}
                        </span>
                      </td>
                      <td>{h.serverName}</td>
                      <td>{h.items.length}</td>
                      <td>
                        <span
                          className={`tag ${
                            h.status === 'success' ? 'ok' : h.status === 'running' ? 'run' : 'err'
                          }`}
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button className="btn" type="button" onClick={() => setActive(h)}>
                            详情
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

      {active && (
        <Modal
          title={`详情 — ${active.serverName}`}
          wide
          onClose={() => setActive(null)}
          footer={
            <button className="btn" type="button" onClick={() => setActive(null)}>
              关闭
            </button>
          }
        >
          <div className="history-meta">
            <span className="muted">
              {new Date(active.startedAt).toLocaleString()}
              {active.finishedAt ? ` → ${new Date(active.finishedAt).toLocaleString()}` : ''}
            </span>
            <span
              className={`tag ${
                historyModeKind(active.mode) === 'image-deploy' ? 'run' : 'ok'
              }`}
            >
              {modeLabel(active.mode)}
            </span>
            <span
              className={`tag ${
                active.status === 'success' ? 'ok' : active.status === 'running' ? 'run' : 'err'
              }`}
            >
              {active.status}
            </span>
          </div>

          <div className="history-items">
            {active.items.map((item) => (
              <div key={item.repoId} className="history-item-row">
                <span>
                  {item.repoName}
                  {item.branch && item.branch !== '-' ? ` @ ${item.branch}` : ''}
                </span>
                <span className="muted cell-ellipsis" title={item.remotePath}>
                  {item.remotePath}
                </span>
                <span
                  className={`tag ${
                    item.status === 'success' ? 'ok' : item.status === 'running' ? 'run' : 'err'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>

          <div className="log-panel">
            <LogViewer
              lines={logLines}
              copyText={active.logTail || ''}
              emptyText="无日志"
              boxClassName="log-box log-box-modal"
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
