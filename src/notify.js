import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = 'BB7ED6M2snpVJUW7F6AiSWIBkZzPnj4gu0Co09_fdtv5NZm5YG-EmKwM25XTT-MMJT5bJ2aDNgS37EmNwP1PDwg'

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function enablePush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  const reg = await navigator.serviceWorker.register('/push-sw.js')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const raw = sub.toJSON()
  await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: raw.endpoint,
      p256dh: raw.keys.p256dh,
      auth_key: raw.keys.auth,
    },
    { onConflict: 'endpoint' }
  )
}


let ctx = null

// browsers only allow sound after the person has tapped something once
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = ctx || new AC()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    // ignore
  }
}

// a short, soft two-note "ping"
export function playPing() {
  try {
    unlockAudio()
    if (!ctx) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.setValueAtTime(1175, t + 0.09)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.32)
  } catch {
    // ignore
  }
}

// the number on the installed app icon (where the phone supports it)
export function setBadge(n) {
  try {
    const p = n > 0 ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.()
    p?.catch?.(() => {})
  } catch {
    // ignore
  }
}

// a phone notification (only used when the app is not on screen)
export async function showNotification(title, body, tag, data) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
    if (reg) {
      await reg.showNotification(title, {
        body,
        tag,
        data,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        renotify: true,
      })
      return
    }
    const n = new Notification(title, { body, tag, icon: '/icon-192.png' })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // ignore
  }
}