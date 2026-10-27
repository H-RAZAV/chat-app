// a 16-point seal shape, made once
const SEAL = (() => {
  const pts = []
  const n = 16
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? 9.6 : 11.6
    const a = (Math.PI * i) / n - Math.PI / 2
    pts.push((12 + r * Math.cos(a)).toFixed(2) + ',' + (12 + r * Math.sin(a)).toFixed(2))
  }
  return pts.join(' ')
})()

function Seal({ fill, check, size, title }) {
  return (
    <svg className="seal" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title}>
      <title>{title}</title>
      <polygon points={SEAL} fill={fill} />
      <path d="M7.6 12.4l3 3 5.8-6.2" fill="none" stroke={check} strokeWidth="2.3"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// gold = the official Veil account, blue = verified by Veil
export function Verified({ profile, size = 16 }) {
  if (!profile) return null
  if (profile.is_official) return <Seal fill="#d9a53b" check="#0c1525" size={size} title="Official Veil account" />
  if (profile.verified) return <Seal fill="#1d9bf0" check="#ffffff" size={size} title="Verified by Veil" />
  return null
}

// a name with its tick
export function Name({ p, size = 16 }) {
  const n = p?.display_name || p?.username || ''
  return (
    <span className="nm">
      <span className="txt">{n || '...'}</span>
      <Verified profile={p} size={size} />
    </span>
  )
}

export function Tags({ profile }) {
  const list = [...(profile?.is_official ? ['Official'] : []), ...(profile?.tags || [])]
  if (!list.length) return null
  return (
    <div className="tags">
      {list.map((t) => <span key={t} className="tag">{t}</span>)}
    </div>
  )
}