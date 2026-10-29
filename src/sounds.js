let ctx = null

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// browsers only allow sound after the first tap or key press
export function unlockSounds() {
  getCtx()
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockSounds)
  window.addEventListener('keydown', unlockSounds)
}

function tone(freq, start, dur, vol = 0.2, type = 'sine') {
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime + start
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(c.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

export function playReceive() {
  tone(880, 0, 0.18, 0.2)
  tone(1318, 0.12, 0.3, 0.2)
}

export function playSend() {
  tone(740, 0, 0.1, 0.12)
  tone(988, 0.07, 0.15, 0.12)
}

export function playEnd() {
  tone(520, 0, 0.15, 0.15)
  tone(390, 0.15, 0.28, 0.15)
}

let loop = null

export function stopRing() {
  clearInterval(loop)
  loop = null
}

function startLoop(pattern, every) {
  stopRing()
  pattern()
  loop = setInterval(pattern, every)
}

// the sound the person being called hears
export function startRingtone() {
  startLoop(() => {
    ;[0, 0.35, 0.7, 1.05].forEach((t, i) => tone(i % 2 ? 784 : 988, t, 0.3, 0.25, 'triangle'))
  }, 2800)
}

// the sound the caller hears while it rings
export function startRingback() {
  startLoop(() => {
    tone(440, 0, 1, 0.1)
    tone(480, 0, 1, 0.1)
  }, 3500)
}