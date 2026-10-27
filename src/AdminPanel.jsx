import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Icon from './Icon'
import Avatar from './Avatar'
import { Name } from './Verified'
import { derivePairKey, sealJson } from './crypto'

const SUGGEST = ['Support', 'Developer', 'Beta tester', 'Founder', 'VIP']

function ago(ts) {
  if (!ts) return 'never'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return m + ' min ago'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' h ago'
  return Math.round(h / 24) + ' days ago'
}

// ---------- numbers ----------
function Overview() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')

  function load() {
    supabase.rpc('admin_stats').then(({ data, error }) => (error ? setErr(error.message) : setS(data)))
  }
  useEffect(() => { load() }, [])

  if (err) return <p className="msg">{err}</p>
  if (!s) return <p className="empty">Loading...</p>
  const cards = [
    ['Veil users', s.total],
    ['New this week', s.new7],
    ['Active today', s.active24],
    ['Active this week', s.active7],
    ['Encryption set up', s.encrypted],
    ['Verified (blue tick)', s.verified],
  ]
  return (
    <>
      <div className="stat-grid">
        {cards.map(([label, value]) => (
          <div className="stat" key={label}><b>{value}</b><span>{label}</span></div>
        ))}
      </div>
      <button className="link-btn" onClick={load}>Refresh</button>
    </>
  )
}

// ---------- people ----------
function Users({ onOpenChat }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [tagText, setTagText] = useState('')

  async function load(reset) {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.rpc('admin_list_users', {
      q: q.trim(),
      max_rows: 50,
      skip_rows: reset ? 0 : rows.length,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setRows((prev) => (reset ? data : [...prev, ...data]))
    setMore(data.length === 50)
  }

  useEffect(() => {
    const t = setTimeout(() => load(true), 300)
    return () => clearTimeout(t)
  }, [q])

  async function toggleVerified(u) {
    const { error } = await supabase.rpc('admin_set_verified', { target: u.id, val: !u.verified })
    if (error) return setErr(error.message)
    setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, verified: !u.verified } : r)))
  }

  async function saveTags(u) {
    const list = tagText.split(',').map((t) => t.trim().slice(0, 20)).filter(Boolean).slice(0, 3)
    const { error } = await supabase.rpc('admin_set_tags', { target: u.id, new_tags: list })
    if (error) return setErr(error.message)
    setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, tags: list } : r)))
    setOpen(null)
  }

  function addSuggestion(t) {
    const cur = tagText.split(',').map((x) => x.trim()).filter(Boolean)
    if (!cur.includes(t) && cur.length < 3) setTagText([...cur, t].join(', '))
  }

  return (
    <>
      <input type="text" placeholder="Search by name, username or email" value={q}
             onChange={(e) => setQ(e.target.value)} />
      {err && <p className="msg">{err}</p>}

      <div>
        {rows.map((u) => (
          <div className="urow" key={u.id}>
            <div className="urow-main">
              <Avatar profile={u} size={40} />
              <div className="meta">
                <Name p={u} />
                <small>@{u.username} · {u.email}</small>
                <small>
                  Joined {new Date(u.created_at).toLocaleDateString()} · active {ago(u.last_seen)}
                  {u.has_key ? '' : ' · no encryption yet'}
                </small>
                {(u.tags || []).length > 0 && (
                  <div className="tags" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                    {u.tags.map((t) => <span className="tag" key={t}>{t}</span>)}
                  </div>
                )}
              </div>
            </div>

            <div className="urow-actions">
              <button className="mini" onClick={() => onOpenChat(u)}>Message</button>
              {!u.is_official && (
                <>
                  <button className={'mini' + (u.verified ? ' on' : '')} onClick={() => toggleVerified(u)}>
                    {u.verified ? 'Remove blue tick' : 'Give blue tick'}
                  </button>
                  <button className="mini" onClick={() => { setOpen(open === u.id ? null : u.id); setTagText((u.tags || []).join(', ')) }}>
                    Tags
                  </button>
                </>
              )}
            </div>

            {open === u.id && (
              <div className="tag-edit">
                <input type="text" value={tagText} onChange={(e) => setTagText(e.target.value)}
                       placeholder="Up to 3 tags, separated by commas" />
                <div className="sugg">
                  {SUGGEST.map((t) => <button key={t} onClick={() => addSuggestion(t)}>{t}</button>)}
                </div>
                <button className="mini on" onClick={() => saveTags(u)}>Save tags</button>
              </div>
            )}
          </div>
        ))}
        {!rows.length && !busy && <p className="empty">No users found.</p>}
      </div>

      {more && <button className="mini" disabled={busy} onClick={() => load(false)}>{busy ? 'Loading...' : 'Show more'}</button>}
    </>
  )
}

// ---------- announcements ----------
function Broadcast({ myId, keys }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [msg, setMsg] = useState({ text: '', ok: false })
  const [history, setHistory] = useState([])

  function loadHistory() {
    supabase.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setHistory(data || []))
  }
  useEffect(() => { loadHistory() }, [])

  async function recipients() {
    let all = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('profiles').select('id, public_key')
        .not('public_key', 'is', null).neq('id', myId)
        .range(from, from + 999)
      if (error) throw error
      all = all.concat(data)
      if (data.length < 1000) break
    }
    return all
  }

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    setMsg({ text: '', ok: false })
    setBusy(true)
    try {
      const list = await recipients()
      const { count } = await supabase
        .from('profiles').select('id', { count: 'exact', head: true }).neq('id', myId)
      const skipped = Math.max(0, (count || 0) - list.length)
      if (!list.length) throw new Error('Nobody has set up encryption yet, so there is nobody to send to.')

      const ok = window.confirm(
        `Send this announcement to ${list.length} people?` +
          (skipped ? `\n\n${skipped} people have not set up encryption yet and will not get it.` : '')
      )
      if (!ok) {
        setBusy(false)
        return
      }

      let done = 0
      let failed = 0
      setProgress({ done: 0, total: list.length })
      for (let i = 0; i < list.length; i += 50) {
        const rows = []
        await Promise.all(
          list.slice(i, i + 50).map(async (p) => {
            try {
              const key = await derivePairKey(keys.priv, keys.pub, p.public_key)
              const enc = await sealJson(key, myId + '|' + p.id, { t: body })
              rows.push({ receiver_id: p.id, content: '', enc, is_broadcast: true })
            } catch {
              failed++
            }
          })
        )
        if (rows.length) {
          const { error } = await supabase.from('messages').insert(rows)
          if (error) throw error
          done += rows.length
        }
        setProgress({ done: done + failed, total: list.length })
      }
      await supabase.from('broadcasts').insert({ body, recipients: done })
      setText('')
      setMsg({
        text: `Sent to ${done} people.` + (failed ? ` ${failed} failed.` : '') + (skipped ? ` ${skipped} skipped (no encryption yet).` : ''),
        ok: true,
      })
      loadHistory()
    } catch (e) {
      setMsg({ text: e.message || 'Something went wrong.', ok: false })
    }
    setBusy(false)
    setProgress(null)
  }

  return (
    <>
      <p className="sec-hint">
        This message goes to every Veil user who has set up encryption. Each copy is encrypted separately on this
        device, so keep this window open until it finishes.
      </p>
      <textarea rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Write your announcement..." disabled={busy} />
      <span className="counter">{text.length}/2000</span>

      {text.trim() && (
        <div className="pv-chat">
          <div className="bubble them">
            <div className="bcast"><Icon name="megaphone" size={13} /> Announcement</div>
            {text.trim()}
          </div>
        </div>
      )}

      {progress && (
        <div>
          <div className="bar-progress"><i style={{ width: (progress.done / progress.total) * 100 + '%' }} /></div>
          <p className="sec-hint">{progress.done} / {progress.total}</p>
        </div>
      )}

      <button className="primary" disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Sending...' : 'Send to everyone'}
      </button>
      {msg.text && <p className={'msg' + (msg.ok ? ' ok' : '')}>{msg.text}</p>}

      {history.length > 0 && (
        <div className="hist">
          <div className="sec-title">Sent announcements</div>
          {history.map((h) => (
            <div className="hist-item" key={h.id}>
              {h.body}
              <small>{new Date(h.created_at).toLocaleString()} · {h.recipients} people</small>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function AdminPanel({ myId, keys, onClose, onOpenChat }) {
  const [tab, setTab] = useState('overview')
  return (
    <div className="modal">
      <div className="panel wide">
        <div className="panel-head">
          <h3>Veil admin</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="tabs">
          {[['overview', 'Overview'], ['users', 'Users'], ['broadcast', 'Broadcast']].map(([v, label]) => (
            <button key={v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{label}</button>
          ))}
        </div>
        <div className="panel-body">
          {tab === 'overview' && <Overview />}
          {tab === 'users' && <Users onOpenChat={onOpenChat} />}
          {tab === 'broadcast' && <Broadcast myId={myId} keys={keys} />}
        </div>
      </div>
    </div>
  )
}