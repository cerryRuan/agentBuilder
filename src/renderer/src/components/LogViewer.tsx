import { useEffect, useMemo, useRef, useState } from 'react'

export interface LogViewerLine {
  id: string
  className?: string
  text: string
}

interface Props {
  title?: string
  lines: LogViewerLine[]
  emptyText?: string
  boxClassName?: string
  /** 复制用纯文本；默认用 lines 的 text 用换行拼接 */
  copyText?: string
  className?: string
  /** 任务进行中：显示 loading / 已用时 */
  running?: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  try {
    const re = new RegExp(`(${escapeRegExp(q)})`, 'gi')
    const parts = text.split(re)
    if (parts.length === 1) return text
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark key={i} className="log-search-mark">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    )
  } catch {
    return text
  }
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
      />
    </svg>
  )
}

function formatElapsed(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function LogViewer({
  title = '运行日志',
  lines,
  emptyText = '等待任务…',
  boxClassName = 'log-box',
  copyText,
  className,
  running = false
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [copied, setCopied] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const stickBottomRef = useRef(true)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) {
      startedAtRef.current = null
      setElapsed(0)
      return
    }
    if (startedAtRef.current == null) startedAtRef.current = Date.now()
    const tick = (): void => {
      const start = startedAtRef.current || Date.now()
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [running])

  const matchIndexes = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return [] as number[]
    const hits: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].text.toLowerCase().includes(q)) hits.push(i)
    }
    return hits
  }, [lines, query])

  // 查询变化时回到第一条
  useEffect(() => {
    setActiveMatch(0)
  }, [query])

  // 匹配数变少时钳制 index
  useEffect(() => {
    if (matchIndexes.length === 0) {
      setActiveMatch(0)
      return
    }
    setActiveMatch((i) => Math.min(i, matchIndexes.length - 1))
  }, [matchIndexes.length])

  const currentLineIndex = matchIndexes[activeMatch]

  useEffect(() => {
    if (currentLineIndex == null) return
    const el = lineRefs.current.get(currentLineIndex)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentLineIndex, query])

  // 无搜索时，新日志贴底（用户上滚则暂停）
  useEffect(() => {
    if (query.trim()) return
    if (!stickBottomRef.current || !boxRef.current) return
    boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines, query])

  const go = (delta: number): void => {
    if (matchIndexes.length === 0) return
    setActiveMatch((i) => (i + delta + matchIndexes.length) % matchIndexes.length)
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    } else if (e.key === 'F3') {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    }
  }

  const doCopy = async (): Promise<void> => {
    const text = (copyText ?? lines.map((l) => l.text).join('\n')).trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      alert('复制失败')
    }
  }

  const matchLabel =
    !query.trim()
      ? ''
      : matchIndexes.length === 0
        ? '无匹配'
        : `${activeMatch + 1}/${matchIndexes.length}`

  return (
    <div className={className}>
      <div className="log-panel-head">
        <div className="log-title-row">
          <h3>{title}</h3>
          {running && (
            <span className="log-running" title="任务进行中">
              <span className="log-running-spinner" aria-hidden />
              执行中 {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <div className="log-toolbar">
          <div className="log-search">
            <input
              type="search"
              className="log-search-input"
              placeholder="搜索日志…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              disabled={lines.length === 0}
              aria-label="搜索日志"
            />
            {query.trim() && (
              <span className={`log-search-count ${matchIndexes.length === 0 ? 'empty' : ''}`}>
                {matchLabel}
              </span>
            )}
            <button
              className="btn ghost log-nav-btn"
              type="button"
              title="上一条（Shift+Enter）"
              disabled={matchIndexes.length === 0}
              onClick={() => go(-1)}
            >
              ↑
            </button>
            <button
              className="btn ghost log-nav-btn"
              type="button"
              title="下一条（Enter）"
              disabled={matchIndexes.length === 0}
              onClick={() => go(1)}
            >
              ↓
            </button>
          </div>
          <button
            className="btn ghost log-copy-btn"
            type="button"
            title="复制日志"
            disabled={lines.length === 0}
            onClick={() => void doCopy()}
          >
            <CopyIcon />
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <div
        className={boxClassName}
        ref={boxRef}
        onScroll={() => {
          const box = boxRef.current
          if (!box) return
          const dist = box.scrollHeight - box.scrollTop - box.clientHeight
          stickBottomRef.current = dist < 40
        }}
      >
        {lines.length === 0 ? (
          <span className="muted">{emptyText}</span>
        ) : (
          lines.map((l, i) => {
            const isHit = matchIndexes.includes(i)
            const isCurrent = i === currentLineIndex
            return (
              <div
                key={l.id}
                ref={(el) => {
                  if (el) lineRefs.current.set(i, el)
                  else lineRefs.current.delete(i)
                }}
                className={[
                  l.className || '',
                  isHit ? 'log-search-hit' : '',
                  isCurrent ? 'log-search-current' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {highlightText(l.text, query)}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
