import { useEffect, useState } from 'react'
import Icon from './Icon'
import VoicePlayer from './VoicePlayer'
import { getUrl, downloadFile } from './files'

const sizeText = (b) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'

export default function Attachment({ m, onOpen }) {
  const [url, setUrl] = useState(null)
  const type = m.file_type || ''
  const needsUrl = type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')

  useEffect(() => {
    if (!needsUrl) return
    let cancelled = false
    getUrl(m.file_path).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => { cancelled = true }
  }, [m.file_path])

  if (needsUrl && !url) return <div className="file-loading">Loading file...</div>

  if (type.startsWith('image/'))
    return <img className="att-img" src={url} alt={m.file_name} onClick={onOpen} />

  if (type.startsWith('video/'))
    return (
      <div className="att-video-wrap" onClick={onOpen}>
        <video src={url + '#t=0.1'} preload="metadata" muted playsInline />
        <span className="play-badge"><Icon name="play" size={26} /></span>
      </div>
    )

  if (type.startsWith('audio/')) return <VoicePlayer src={url} seed={m.id} duration={m.duration} />

  return (
    <a className="att-file" href="#" onClick={(e) => { e.preventDefault(); downloadFile(m.file_path, m.file_name) }}>
      <Icon name="file" size={30} />
      <span>
        {m.file_name}
        <small>{sizeText(m.file_size)}</small>
      </span>
    </a>
  )
}