import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Icon from './Icon'
import VoicePlayer from './VoicePlayer'

const sizeText = (b) =>
  b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'

export default function Attachment({ m }) {
  const [url, setUrl] = useState(null)
  const type = m.file_type || ''
  const isMedia = type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')

  useEffect(() => {
    let cancelled = false
    supabase.storage
      .from('chat-files')
      .createSignedUrl(m.file_path, 86400, isMedia ? undefined : { download: m.file_name })
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl || null)
      })
    return () => { cancelled = true }
  }, [m.file_path])

  if (!url) return <div className="file-loading">Loading file...</div>

  if (type.startsWith('image/'))
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img className="att-img" src={url} alt={m.file_name} />
      </a>
    )
  if (type.startsWith('audio/')) return <VoicePlayer src={url} seed={m.id} duration={m.duration} />
  if (type.startsWith('video/')) return <video className="att-video" controls preload="metadata" src={url} />

  return (
    <a className="att-file" href={url} download={m.file_name}>
      <Icon name="file" size={30} />
      <span>
        {m.file_name}
        <small>{sizeText(m.file_size)}</small>
      </span>
    </a>
  )
}