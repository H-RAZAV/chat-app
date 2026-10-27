import { supabase } from './supabaseClient'
import { openBytes } from './crypto'

const links = new Map() // file path -> link the browser can show

async function signed(path, seconds, options) {
  const { data } = await supabase.storage.from('chat-files').createSignedUrl(path, seconds, options)
  return data?.signedUrl || null
}

async function load(m) {
  if (!m.file_key) return signed(m.file_path, 86400) // old file from before encryption
  const link = await signed(m.file_path, 300)
  if (!link) return null
  const res = await fetch(link)
  if (!res.ok) throw new Error('download failed')
  const plain = await openBytes(await res.arrayBuffer(), m.file_key)
  return URL.createObjectURL(new Blob([plain], { type: m.file_type || 'application/octet-stream' }))
}

// a link to show the file (decrypted here, on this device)
export function getUrl(m) {
  if (!links.has(m.file_path)) {
    links.set(
      m.file_path,
      load(m).catch(() => {
        links.delete(m.file_path)
        return null
      })
    )
  }
  return links.get(m.file_path)
}

// saves the file to the phone or computer
export async function downloadFile(m) {
  if (!m.file_key) {
    const link = await signed(m.file_path, 300, { download: m.file_name })
    if (link) window.location.assign(link)
    return
  }
  const url = await getUrl(m)
  if (!url) return
  const a = document.createElement('a')
  a.href = url
  a.download = m.file_name || 'file'
  document.body.appendChild(a)
  a.click()
  a.remove()
}