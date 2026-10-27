import { useRef, useState } from 'react'
import Icon from './Icon'
import {
  ACCENTS, PRESETS, BG_OPTIONS, DEFAULTS, getAppearance, setAppearance, resolveTheme,
  bgPreview, setChatPhoto, clearChatPhoto, hasChatPhoto,
} from './theme'

export default function Appearance({ onClose }) {
  const [a, setA] = useState(getAppearance())
  const [err, setErr] = useState('')
  const fileRef = useRef(null)
  const theme = resolveTheme(a.mode)
  const change = (patch) => setA(setAppearance(patch))
  const customAccent = a.accent && !ACCENTS.some((c) => c.value === a.accent)

  async function pickPhoto(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    setErr('')
    try {
      await setChatPhoto(f)
      change({ bg: 'image' })
    } catch (x) {
      setErr(x.message)
    }
  }

  function reset() {
    clearChatPhoto()
    setErr('')
    change({ ...DEFAULTS })
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Appearance</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>

        <div className="panel-body">
          <div className="pv-chat">
            <div className="bubble them">Hi! How does this look?<span className="t">10:21</span></div>
            <div className="bubble me">
              I love it
              <span className="t">10:22 <Icon name="checkAll" size={16} className="tick read" /></span>
            </div>
          </div>

          <div className="sec-title">Themes</div>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button key={p.id} className="preset" style={{ '--dot': p.dot }} onClick={() => change(p.patch)}>
                <i style={bgPreview(p.patch.bg, theme, a.bgColor)} />
                {p.name}
              </button>
            ))}
          </div>

          <div className="sec-title">Mode</div>
          <div className="seg">
            {[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => (
              <button key={v} className={a.mode === v ? 'on' : ''} onClick={() => change({ mode: v })}>{label}</button>
            ))}
          </div>

          <div className="sec-title">Accent color</div>
          <div className="swatches">
            {ACCENTS.map((c) => (
              <button
                key={c.name}
                title={c.name}
                className={'swatch' + ((a.accent || null) === c.value ? ' on' : '')}
                style={{ background: c.value || '#d4a24c' }}
                onClick={() => change({ accent: c.value })}
              />
            ))}
            <span className={'swatch custom' + (customAccent ? ' on' : '')} title="Pick any color">
              <input type="color" value={a.accent || '#d4a24c'} onChange={(e) => change({ accent: e.target.value })} />
            </span>
          </div>

          <label className="check">
            <input type="checkbox" checked={a.bubbles === 'accent'}
                   onChange={(e) => change({ bubbles: e.target.checked ? 'accent' : 'default' })} />
            My message bubbles use the accent color
          </label>
          <label className="check">
            <input type="checkbox" checked={a.header === 'accent'}
                   onChange={(e) => change({ header: e.target.checked ? 'accent' : 'default' })} />
            Colored top bar
          </label>

          <div className="sec-title">Chat background</div>
          <div className="bg-grid">
            {BG_OPTIONS.map((o) => (
              <button key={o.id} className={'bg-thumb' + (a.bg === o.id ? ' on' : '')}
                      style={bgPreview(o.id, theme, a.bgColor)} onClick={() => change({ bg: o.id })}>
                <span>{o.name}</span>
              </button>
            ))}
            <span className={'bg-thumb' + (a.bg === 'color' ? ' on' : '')}
                  style={bgPreview('color', theme, a.bgColor)}>
              <span>Color</span>
              <input type="color" value={a.bgColor} onChange={(e) => change({ bg: 'color', bgColor: e.target.value })} />
            </span>
            <button className={'bg-thumb' + (a.bg === 'image' ? ' on' : '')}
                    style={bgPreview('image', theme, a.bgColor)}
                    onClick={() => (hasChatPhoto() ? change({ bg: 'image' }) : fileRef.current.click())}>
              <span>Photo</span>
            </button>
          </div>
          <button className="link-btn" onClick={() => fileRef.current.click()}>Choose a photo from this device</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />

          <div className="sec-title">Messages</div>
          <div className="range-row">
            <div className="top"><span>Bubble corners</span><span>{a.radius}</span></div>
            <input type="range" min="0" max="22" value={a.radius}
                   onChange={(e) => change({ radius: Number(e.target.value) })} />
          </div>
          <div className="range-row">
            <div className="top"><span>Text size</span><span>{a.font}</span></div>
            <input type="range" min="13" max="20" value={a.font}
                   onChange={(e) => change({ font: Number(e.target.value) })} />
          </div>

          {err && <p className="msg">{err}</p>}
          <button className="link-btn" onClick={reset}>Reset to the Veil look</button>
        </div>
      </div>
    </div>
  )
}