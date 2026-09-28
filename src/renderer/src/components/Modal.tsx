interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}

export default function Modal({ title, onClose, children, footer, wide }: Props): React.JSX.Element {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={wide ? { width: 'min(880px, 100%)' } : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost modal-close" type="button" onClick={onClose} aria-label="关闭" title="关闭">
            <svg className="modal-close-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path
                d="M3 3l8 8M11 3L3 11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
