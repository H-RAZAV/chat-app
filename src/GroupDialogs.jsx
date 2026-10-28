import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Icon from './Icon'
import Avatar from './Avatar'
import { Name } from './Verified'

// a list of people you can tick, plus a username search
function PeoplePicker({ contacts, exclude, selected, onToggle }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])

  useEffect(() => {
    const s = q.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!s) {
      setFound([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('*').ilike('username', s + '%').limit(8)
      setFound(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  const list = (q.trim() ? found : contacts).filter((p) => !exclude.has(p.id) && !p.is_official)

  return (
    <>
      <input type="text" placeholder="Search username" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="pick-list">
        {list.map((p) => (
          <div key={p.id} className={'pick-row' + (p.public_key ? '' : ' off')}
               onClick={() => p.public_key && onToggle(p)}>
            <Avatar profile={p} size={36} />
            <span className="pn">
              <Name p={p} />
              <small>@{p.username}{p.public_key ? '' : ' · has not set up encryption yet'}</small>
            </span>
            <input type="checkbox" readOnly disabled={!p.public_key} checked={selected.has(p.id)} />
          </div>
        ))}
        {!list.length && <p className="empty">No people found</p>}
      </div>
    </>
  )
}

function useSelection(limit) {
  const [sel, setSel] = useState(new Set())
  function toggle(p) {
    setSel((s) => {
      const n = new Set(s)
      if (n.has(p.id)) n.delete(p.id)
      else if (n.size < limit) n.add(p.id)
      return n
    })
  }
  return [sel, toggle, () => setSel(new Set())]
}

export function NewGroup({ contacts, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [sel, toggle] = useSelection(29)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    if (!name.trim()) return setErr('Give the group a name.')
    if (!sel.size) return setErr('Pick at least one person.')
    setBusy(true)
    setErr('')
    try {
      await onCreate(name.trim(), [...sel])
    } catch (e) {
      setErr(e.message || 'Could not create the group.')
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>New group</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="panel-body">
          <input type="text" maxLength={40} placeholder="Group name" value={name}
                 onChange={(e) => setName(e.target.value)} />
          <PeoplePicker contacts={contacts} exclude={new Set()} selected={sel} onToggle={toggle} />
          <p className="sec-hint">{sel.size} selected (up to 29 people, plus you)</p>
          {err && <p className="msg">{err}</p>}
          <button className="primary" disabled={busy} onClick={go}>{busy ? 'Creating...' : 'Create group'}</button>
        </div>
      </div>
    </div>
  )
}

export function GroupInfo({ group, profiles, myId, contacts, onClose, onRename, onAdd, onRemove, onLeave }) {
  const mine = group.members.find((m) => m.user_id === myId)
  const admin = mine?.role === 'admin'
  const [name, setName] = useState(group.name)
  const [adding, setAdding] = useState(false)
  const [sel, toggle, clearSel] = useSelection(30)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: false })
  const exclude = new Set(group.members.map((m) => m.user_id))
  const members = [...group.members].sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1))

  useEffect(() => setName(group.name), [group.name])

  async function run(fn, okText) {
    setBusy(true)
    setMsg({ text: '', ok: false })
    try {
      await fn()
      if (okText) setMsg({ text: okText, ok: true })
    } catch (e) {
      setMsg({ text: e.message || 'Something went wrong.', ok: false })
    }
    setBusy(false)
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Group info</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="panel-body profile-view">
          <Avatar profile={{ display_name: group.name }} size={96} />
          {admin ? (
            <div className="name-edit">
              <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="mini on" disabled={busy || !name.trim() || name.trim() === group.name}
                      onClick={() => run(() => onRename(name.trim()), 'Name changed.')}>
                <Icon name="edit" size={14} /> Save
              </button>
            </div>
          ) : (
            <h2>{group.name}</h2>
          )}
          <p className="pf-user">{group.members.length} people</p>

          <div style={{ width: '100%', textAlign: 'left' }}>
            {members.map((m) => {
              const p = profiles[m.user_id]
              return (
                <div className="mem-row" key={m.user_id}>
                  <Avatar profile={p} size={38} />
                  <div className="mn">
                    <Name p={p} />{m.user_id === myId && ' (you)'}
                    <small>@{p?.username}</small>
                  </div>
                  {m.role === 'admin' && <span className="role">Admin</span>}
                  {admin && m.user_id !== myId && (
                    <button className="mini danger" disabled={busy}
                            onClick={() => window.confirm('Remove this person from the group?') &&
                              run(() => onRemove(m.user_id), 'Removed.')}>
                      Remove
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {admin && !adding && group.members.length < 30 && (
            <button className="mini on" onClick={() => setAdding(true)}>
              <Icon name="userPlus" size={14} /> Add people
            </button>
          )}
          {admin && adding && (
            <div style={{ width: '100%', display: 'grid', gap: 8, textAlign: 'left' }}>
              <PeoplePicker contacts={contacts} exclude={exclude} selected={sel} onToggle={toggle} />
              <button className="primary" disabled={busy || !sel.size || group.members.length + sel.size > 30}
                      onClick={() => run(async () => {
                        await onAdd([...sel])
                        clearSel()
                        setAdding(false)
                      }, 'People added.')}>
                Add {sel.size || ''} {sel.size === 1 ? 'person' : 'people'}
              </button>
            </div>
          )}

          {msg.text && <p className={'msg' + (msg.ok ? ' ok' : '')}>{msg.text}</p>}

          <p className="sec-hint">
            Messages here are end-to-end encrypted. New members can't read what was said before they joined, and
            removed members get nothing new.
          </p>
          <button className="mini danger" disabled={busy} onClick={onLeave}>Leave group</button>
        </div>
      </div>
    </div>
  )
}