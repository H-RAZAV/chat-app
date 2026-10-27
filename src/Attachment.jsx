import { useEffect, useState } from 'react'
import Icon from './Icon'
import VoicePlayer from './VoicePlayer'
import { getUrl, downloadFile } from './files'

const sizeText = (b) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'

export default function Attachment({ m, onOpen }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const type = m.file_type || ''
  const needsUrl = type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')

  useEffect(() => {
    if (!needsUrl) return
    let cancelled = false
    getUrl(m).then((u) => {
      if (cancelled) return
      setUrl(u)
      setFailed(!u)
    })
    return () => { cancelled = true }
  }, [m.file_path])

  if (needsUrl && failed) return <div className="file-loading">Could not load this file</div>
  if (needsUrl && !url) return <div className="file-loading">Loading file...</div>

  if (type.startsWith('image/'))
    return <img className="att-img" src={url} alt={m.file_name} onClick={onOpen} />

  if (type.startsWith('video/'))
    return (
      <div className="att-video-wrap" onClick={onOpen}>
        <video
          src={url}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0.1 }}
        />
        <span className="play-badge"><Icon name="play" size={26} /></span>
      </div>
    )

  if (type.startsWith('audio/')) return <VoicePlayer src={url} seed={m.id} duration={m.duration} />

  return (
    <a className="att-file" href="#" onClick={(e) => { e.preventDefault(); downloadFile(m) }}>
      <Icon name="file" size={30} />
      <span>
        {m.file_name}
        <small>{sizeText(m.file_size)}</small>
      </span>
    </a>
  )
}