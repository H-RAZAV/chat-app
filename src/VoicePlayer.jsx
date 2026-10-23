import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon'

const BARS = 32
const RATES = [1, 1.5, 2]

function mmss(s) {
  if (!isFinite(s) || s < 0) s = 0
  s = Math.floor(s)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

// the same message always gets the same wave shape
function makeBars(seed) {
  let h = 0
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const out = []
  for (let i = 0; i < BARS; i++) {
    h = (h * 1664525 + 1013904223) >>> 0
    out.push(25 + (h % 75))
  }
  return out
}

export default function VoicePlayer({ src, seed, duration }) {
  const audio = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [len, setLen] = useState(duration || 0)
  const [rate, setRate] = useState(1)

  const bars = useMemo(() => makeBars(seed), [seed])
  const progress = len ? Math.min(1, time / len) : 0

  // when another voice message starts, pause this one
  useEffect(() => {
    const onOther = (e) => {
      if (e.detail !== audio.current) audio.current?.pause()
    }
    window.addEventListener('voice-play', onOther)
    return () => window.removeEventListener('voice-play', onOther)
  }, [])

  function readLength() {
    const a = audio.current
    if (a && isFinite(a.duration) && a.duration > 0) setLen(a.duration)
  }

  function toggle() {
    const a = audio.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  function seek(e) {
    const a = audio.current
    if (!a || !len) return
    const box = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    a.currentTime = ratio * len
    setTime(a.currentTime)
  }

  function nextRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
    setRate(next)
    if (audio.current) audio.current.playbackRate = next
  }

  return (
    <div className="voice">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={readLength}
        onDurationChange={readLength}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
          readLength()
        }}
        onPlay={() => {
          setPlaying(true)
          window.dispatchEvent(new CustomEvent('voice-play', { detail: audio.current }))
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setTime(0)
        }}
      />
      <button className="v-play" type="button" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div className="v-main">
        <div className="v-wave" onClick={seek}>
          {bars.map((h, i) => (
            <span key={i} className={'v-bar' + (i / BARS < progress ? ' on' : '')} style={{ height: h + '%' }} />
          ))}
        </div>
        <div className="v-meta">
          <span>{mmss(playing || time > 0 ? time : len)}</span>
          <button className="v-rate" type="button" onClick={nextRate} title="Playback speed">
            {rate}x
          </button>
        </div>
      </div>
    </div>
  )
}