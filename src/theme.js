const KEY = 'veil-appearance'
const PHOTO_KEY = 'veil-chat-photo'

export const DEFAULTS = {
  mode: 'auto',
  accent: null,
  bubbles: 'default',
  header: 'default',
  bg: 'plain',
  bgColor: '#e8dfc9',
  radius: 10,
  font: 15,
}

export const ACCENTS = [
  { name: 'Veil gold', value: null },
  { name: 'Blue', value: '#3390ec' },
  { name: 'Indigo', value: '#5b6cf0' },
  { name: 'Violet', value: '#8e5cf0' },
  { name: 'Pink', value: '#e0527a' },
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f0802a' },
  { name: 'Sand', value: '#b99a6b' },
  { name: 'Green', value: '#34b36b' },
  { name: 'Mint', value: '#2ec4a0' },
  { name: 'Teal', value: '#17a2b8' },
  { name: 'Slate', value: '#6b7f99' },
]

export const PRESETS = [
  { id: 'veil', name: 'Veil', dot: '#d4a24c', patch: { mode: 'auto', accent: null, bubbles: 'default', header: 'default', bg: 'plain' } },
  { id: 'blue', name: 'Classic Blue', dot: '#3390ec', patch: { mode: 'light', accent: '#3390ec', bubbles: 'accent', header: 'accent', bg: 'sky' } },
  { id: 'midnight', name: 'Midnight', dot: '#6c8cff', patch: { mode: 'dark', accent: '#6c8cff', bubbles: 'accent', header: 'default', bg: 'night' } },
  { id: 'forest', name: 'Forest', dot: '#2f9e6b', patch: { mode: 'auto', accent: '#2f9e6b', bubbles: 'accent', header: 'accent', bg: 'forest' } },
  { id: 'rose', name: 'Rose', dot: '#e0527a', patch: { mode: 'light', accent: '#e0527a', bubbles: 'accent', header: 'accent', bg: 'rose' } },
  { id: 'sunset', name: 'Sunset', dot: '#f0802a', patch: { mode: 'auto', accent: '#f0802a', bubbles: 'accent', header: 'default', bg: 'sunset' } },
  { id: 'mono', name: 'Mono', dot: '#586474', patch: { mode: 'auto', accent: '#586474', bubbles: 'accent', header: 'accent', bg: 'mono' } },
  { id: 'doodle', name: 'Doodle', dot: '#d4a24c', patch: { mode: 'auto', accent: null, bubbles: 'default', header: 'default', bg: 'doodle' } },
]

export const BG_OPTIONS = [
  { id: 'plain', name: 'Plain' },
  { id: 'doodle', name: 'Doodle' },
  { id: 'sky', name: 'Sky' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'forest', name: 'Forest' },
  { id: 'rose', name: 'Rose' },
  { id: 'night', name: 'Night' },
  { id: 'mono', name: 'Mono' },
]

const GRADIENTS = {
  sky: { light: 'linear-gradient(160deg,#cfe3f5,#eaf3fa)', dark: 'linear-gradient(160deg,#0b1d33,#07121f)' },
  sunset: { light: 'linear-gradient(160deg,#f6d3bd,#f7ead9)', dark: 'linear-gradient(160deg,#2b1830,#13101f)' },
  forest: { light: 'linear-gradient(160deg,#d3e8d0,#eef4e4)', dark: 'linear-gradient(160deg,#0e2519,#08130d)' },
  rose: { light: 'linear-gradient(160deg,#f6d2dc,#f8e8ec)', dark: 'linear-gradient(160deg,#2c1420,#140b11)' },
  night: { light: 'linear-gradient(160deg,#cfd6e8,#e6e9f3)', dark: 'linear-gradient(160deg,#0a0f24,#05070f)' },
  mono: { light: 'linear-gradient(160deg,#e3e3e3,#f1f1f1)', dark: 'linear-gradient(160deg,#171717,#0c0c0c)' },
}

const MANAGED = [
  '--accent', '--accent-text', '--accent-ink', '--btn', '--btn-text',
  '--bubble-me', '--bubble-me-text', '--bubble-me-sub', '--tick-read',
  '--header', '--header-text',
  '--chat-bg', '--chat-bg-image', '--chat-bg-size', '--chat-bg-repeat',
  '--bubble-radius', '--msg-font',
]

function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key, value) {
  try { localStorage.setItem(key, value); return true } catch { return false }
}

// ---------- colors ----------
function rgb(hex) {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(f, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function toHex(c) {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}
function lum(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// white or dark navy, whichever is easier to read on this color
export function readableOn(hex) {
  const L = lum(hex)
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0575 ? '#ffffff' : '#0c1525'
}
function mixHex(a, b, t) {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

function doodle(theme) {
  const c = theme === 'dark' ? 'rgba(251,245,234,0.06)' : 'rgba(12,21,37,0.07)'
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160' fill='none' stroke='${c}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
    `<circle cx='22' cy='24' r='7'/><path d='M70 18l6 12 12 2-9 8 2 12-11-6-11 6 2-12-9-8 12-2z'/>` +
    `<path d='M120 20q10-10 20 0t-20 22q-20-12 0-22z'/><path d='M28 80h22M39 69v22'/>` +
    `<path d='M84 84l10 20 10-20'/><circle cx='132' cy='88' r='9'/><path d='M20 132q10-14 20 0'/>` +
    `<path d='M74 130h26M74 140h18'/><path d='M126 128l12 12m0-12l-12 12'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

// ---------- saved settings ----------
export function getAppearance() {
  let saved = {}
  try { saved = JSON.parse(read(KEY) || '{}') } catch { saved = {} }
  if (!read(KEY)) {
    const old = read('chat-theme')
    if (old === 'dark' || old === 'light') saved.mode = old
  }
  return { ...DEFAULTS, ...saved }
}

export function resolveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getTheme() {
  return resolveTheme(getAppearance().mode)
}

export function bgPreview(id, theme, color) {
  if (id === 'plain') return { backgroundColor: 'var(--bg-chat)' }
  if (id === 'doodle') return { backgroundColor: 'var(--bg-chat)', backgroundImage: doodle(theme), backgroundSize: '70px' }
  if (id === 'color') return { backgroundColor: color }
  if (id === 'image') {
    const p = read(PHOTO_KEY)
    return p ? { backgroundImage: `url("${p}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { backgroundColor: '#888' }
  }
  return { backgroundImage: GRADIENTS[id][theme] }
}

// ---------- applying the look to the whole app ----------
export function applyAppearance(a = getAppearance()) {
  const root = document.documentElement
  const theme = resolveTheme(a.mode)
  root.setAttribute('data-theme', theme)

  const set = {}
  const accent = a.accent || (a.bubbles === 'accent' || a.header === 'accent' ? '#d4a24c' : null)
  if (accent) {
    const on = readableOn(accent)
    set['--accent'] = accent
    set['--accent-text'] = on
    set['--accent-ink'] = mixHex(accent, theme === 'dark' ? '#ffffff' : '#000000', theme === 'dark' ? 0.28 : 0.38)
    set['--btn'] = accent
    set['--btn-text'] = on
    if (a.bubbles === 'accent') {
      set['--bubble-me'] = accent
      set['--bubble-me-text'] = on
      set['--bubble-me-sub'] = on === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(12,21,37,0.6)'
      set['--tick-read'] = on
    }
    if (a.header === 'accent') {
      set['--header'] = accent
      set['--header-text'] = on
    }
  }

  if (a.bg === 'doodle') {
    set['--chat-bg-image'] = doodle(theme)
    set['--chat-bg-size'] = '160px'
    set['--chat-bg-repeat'] = 'repeat'
  } else if (GRADIENTS[a.bg]) {
    set['--chat-bg-image'] = GRADIENTS[a.bg][theme]
    set['--chat-bg-size'] = 'cover'
    set['--chat-bg-repeat'] = 'no-repeat'
  } else if (a.bg === 'color') {
    set['--chat-bg'] = a.bgColor
  } else if (a.bg === 'image') {
    const p = read(PHOTO_KEY)
    if (p) {
      set['--chat-bg-image'] = `url("${p}")`
      set['--chat-bg-size'] = 'cover'
      set['--chat-bg-repeat'] = 'no-repeat'
    }
  }

  set['--bubble-radius'] = a.radius + 'px'
  set['--msg-font'] = a.font + 'px'

  MANAGED.forEach((name) => {
    if (set[name] !== undefined) root.style.setProperty(name, set[name])
    else root.style.removeProperty(name)
  })
}

export function setAppearance(patch) {
  const next = { ...getAppearance(), ...patch }
  write(KEY, JSON.stringify(next))
  applyAppearance(next)
  return next
}

// kept for older code: 'light' or 'dark'
export function applyTheme(theme) {
  return setAppearance({ mode: theme })
}

export function initAppearance() {
  applyAppearance()
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getAppearance().mode === 'auto') applyAppearance()
    })
  }
}

// ---------- your own chat photo ----------
export const hasChatPhoto = () => !!read(PHOTO_KEY)

export function clearChatPhoto() {
  try { localStorage.removeItem(PHOTO_KEY) } catch { /* ignore */ }
}

export function setChatPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      if (!write(PHOTO_KEY, c.toDataURL('image/jpeg', 0.75))) {
        reject(new Error('This picture is too big to save on this device.'))
      } else resolve()
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image.'))
    }
    img.src = url
  })
}