import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { getUrl, downloadFile } from './files'

export default function MediaViewer({ items, index, onIndex, onClose, titleOf }) {
  const m = items[index]
  const [url, setUrl] = useState(null)
  const touchX = useRef(null)
  const isVideo = (m.file_type || '').startsWith('video/')

  useEffect(() => {
    let off = false
    setUrl(null)
    getUrl(m.file_path).then((u) => {
      if (!off) setUrl(u)
    })
    // get the next and previous ones ready
    if (items[index - 1]) getUrl(items[index - 1].file_path)
    if (items[index + 1]) getUrl(items[index + 1].file_path)
    return () => { off = true }
  }, [m.file_path])

  const prev = () => index > 0 && onIndex(index - 1)
  const next = () => index < items.length - 1 && onIndex(index + 1)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function onTouchEnd(e) {
    if (touchX.current === null || e.target.tagName === 'VIDEO') return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (dx > 60) prev()
    else if (dx < -60) next()
  }

  const stop = (e) => e.stopPropagation()

  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer-bar" onClick={stop}>
        <button title="Close" onClick={onClose}><Icon name="close" size={22} /></button>
        <div className="viewer-title">
          <b>{titleOf(m)}</b>
          <small>{new Date(m.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </div>
        <button title="Download" onClick={() => downloadFile(m.file_path, m.file_name)}>
          <Icon name="download" size={22} />
        </button>
      </div>

      <div
        className="viewer-stage"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={onTouchEnd}
      >
        {!url ? (
          <span className="viewer-loading">Loading...</span>
        ) : isVideo ? (
          <video key={m.id} src={url} controls autoPlay playsInline onClick={stop} />
        ) : (
          <img key={m.id} src={url} alt={m.file_name} onClick={stop} />
        )}
      </div>

      {index > 0 && (
        <button className="viewer-nav left" onClick={(e) => { stop(e); prev() }}>
          <Icon name="left" size={24} />
        </button>
      )}
      {index < items.length - 1 && (
        <button className="viewer-nav right" onClick={(e) => { stop(e); next() }}>
          <Icon name="right" size={24} />
        </button>
      )}
      <div className="viewer-count">{index + 1} / {items.length}</div>
    </div>
  )
}