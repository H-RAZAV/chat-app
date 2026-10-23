import { useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Avatar from './Avatar'
   import Icon from './Icon'

// crop to a square and shrink the photo so it loads fast
function resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      canvas.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image'))
    }
    img.src = url
  })
}

export default function Settings({ me, onClose, onSaved }) {
  const [username, setUsername] = useState(me.username)
  const [displayName, setDisplayName] = useState(me.display_name || '')
  const [about, setAbout] = useState(me.about || '')
  const [hideSeen, setHideSeen] = useState(!!me.hide_last_seen)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ text: '', ok: false })
  const fileRef = useRef(null)

  const say = (text, ok = false) => setMsg({ text, ok })

  async function removeOldPhotos(keepName) {
    const { data } = await supabase.storage.from('avatars').list(me.id)
    const old = (data || []).filter((f) => f.name !== keepName).map((f) => `${me.id}/${f.name}`)
    if (old.length) await supabase.storage.from('avatars').remove(old)
  }

  async function pickPhoto(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return say('Please choose an image file.')
    setBusy(true)
    say('')
    try {
      const blob = await resizeImage(f, 256)
      const name = `avatar-${Date.now()}.jpg`
      const path = `${me.id}/${name}`
      const { error: upErr } = await supabase.storage
        .from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const { data, error } = await supabase
        .from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', me.id).select().single()
      if (error) throw error
      onSaved(data)
      removeOldPhotos(name)
      say('Photo updated.', true)
    } catch (err) {
      say(err.message)
    }
    setBusy(false)
  }

  async function removePhoto() {
    setBusy(true)
    say('')
    const { data, error } = await supabase
      .from('profiles').update({ avatar_url: null }).eq('id', me.id).select().single()
    if (error) say(error.message)
    else {
      onSaved(data)
      removeOldPhotos(null)
      say('Photo removed.', true)
    }
    setBusy(false)
  }

  async function saveProfile() {
    say('')
    const name = username.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(name)) {
      return say('Username must be 3-20 characters: letters, numbers or underscore only.')
    }
    setBusy(true)
    if (name !== me.username) {
      const { data: free } = await supabase.rpc('username_available', { u: name })
      if (!free) {
        setBusy(false)
        return say('That username is already taken.')
      }
    }
    const { data, error } = await supabase
      .from('profiles')
      .update({
        username: name,
        display_name: displayName.trim() || null,
        about: about.trim() || null,
        hide_last_seen: hideSeen,
      })
      .eq('id', me.id)
      .select()
      .single()
    setBusy(false)
    if (error) return say(error.message)
    setUsername(data.username)
    onSaved(data)
    say('Profile saved.', true)
  }

  async function changePassword() {
    say('')
    if (pw.length < 6) return say('Password must be at least 6 characters.')
    if (pw !== pw2) return say('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return say(error.message)
    setPw('')
    setPw2('')
    say('Password changed.', true)
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Settings</h3>
             <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>

        <div className="panel-body">
          <div className="photo-row">
            <Avatar profile={me} size={110} />
            <div className="photo-actions">
              <button className="link-btn" disabled={busy} onClick={() => fileRef.current.click()}>
                Change photo
              </button>
              {me.avatar_url && (
                <button className="link-btn" disabled={busy} onClick={removePhoto}>Remove</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickPhoto} />
          </div>

          <label>
            Display name
            <input type="text" maxLength={40} value={displayName}
                   onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </label>

          <label>
            Username (used to find you)
            <input type="text" maxLength={20} value={username}
                   onChange={(e) => setUsername(e.target.value)} />
          </label>

          <label>
            About
            <textarea rows={2} maxLength={140} value={about}
                      onChange={(e) => setAbout(e.target.value)} placeholder="Hey there! I am using this chat." />
            <span className="counter">{about.length}/140</span>
          </label>

          <label className="check">
            <input type="checkbox" checked={hideSeen} onChange={(e) => setHideSeen(e.target.checked)} />
            Hide my last seen and online status
          </label>

          <button className="primary" disabled={busy} onClick={saveProfile}>
            {busy ? 'Please wait...' : 'Save profile'}
          </button>

          <hr />

          <label>
            New password
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                   placeholder="At least 6 characters" />
          </label>
          <label>
            Repeat new password
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </label>
          <button className="primary" disabled={busy || !pw} onClick={changePassword}>
            Change password
          </button>

          {msg.text && <p className={'msg' + (msg.ok ? ' ok' : '')}>{msg.text}</p>}
        </div>
      </div>
    </div>
  )
}