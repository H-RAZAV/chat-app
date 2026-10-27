import { supabase } from './supabaseClient'

const cache = new Map()

// a link to view a file; remembered so photos don't reload every time
export function getUrl(path) {
  const hit = cache.get(path)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url)
  return supabase.storage
    .from('chat-files')
    .createSignedUrl(path, 86400)
    .then(({ data }) => {
      if (!data?.signedUrl) return null
      cache.set(path, { url: data.signedUrl, exp: Date.now() + 82800000 })
      return data.signedUrl
    })
}

// saves the file to the phone or computer without leaving Veil
export async function downloadFile(path, name) {
  const { data } = await supabase.storage
    .from('chat-files')
    .createSignedUrl(path, 300, { download: name })
  if (data?.signedUrl) window.location.assign(data.signedUrl)
}