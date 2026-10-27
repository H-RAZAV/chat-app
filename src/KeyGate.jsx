import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import ChatScreen from './ChatScreen'
import {
  cryptoReady, createIdentity, wrapPrivate, unwrapPrivate, importPrivate, saveKey, loadKey,
} from './crypto'

export default function KeyGate({ session }) {
  const myId = session.user.id
  const [stage, setStage] = useState('loading') // loading | setup | unlock | ready | error
  const [serverPub, setServerPub] = useState(null)
  const [keys, setKeys] = useState(null)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [reset, setReset] = useState(false)

  useEffect(() => {
    let off = false
    async function check() {
      if (!cryptoReady) {
        setErr('Encryption needs a secure connection (https). Open Veil from its https address.')
        setStage('error')
        return
      }
      const { data: prof, error } = await supabase.from('profiles').select('public_key').eq('id', myId).single()
      if (off) return
      if (error) {
        setErr(error.message)
        setStage('error')
        return
      }
      const pub = prof?.public_key || null
      setServerPub(pub)
      if (!pub) {
        setStage('setup')
        return
      }
      const local = await loadKey(myId).catch(() => null)
      if (off) return
      if (local && local.pub === pub) {
        setKeys({ priv: local.key, pub })
        setStage('ready')
      } else {
        setStage('unlock')
      }
    }
    check()
    return () => { off = true }
  }, [myId])

  async function setup(e) {
    e.preventDefault()
    setErr('')
    if (pass.length < 10) return setErr('Use at least 10 characters. Four random words work well.')
    if (pass !== pass2) return setErr('The two passphrases do not match.')
    if (!ack) return setErr('Please tick the box to confirm you understand.')
    setBusy(true)
    try {
      const { pub, pkcs8 } = await createIdentity()
      const backup = await wrapPrivate(pkcs8, pass)
      const { error: e1 } = await supabase
        .from('key_backups')
        .upsert({ user_id: myId, ...backup, updated_at: new Date().toISOString() })
      if (e1) throw e1
      const { error: e2 } = await supabase.from('profiles').update({ public_key: pub }).eq('id', myId)
      if (e2) throw e2
      const priv = await importPrivate(pkcs8)
      await saveKey(myId, priv, pub)
      setKeys({ priv, pub })
      setStage('ready')
    } catch (x) {
      setErr(x.message || 'Something went wrong. Try again.')
    }
    setBusy(false)
  }

  async function unlock(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const { data: backup, error } = await supabase.from('key_backups').select('*').eq('user_id', myId).single()
      if (error || !backup) throw new Error('missing')
      let pkcs8
      try {
        pkcs8 = await unwrapPrivate(backup, pass)
      } catch {
        setErr('Wrong passphrase. Try again.')
        setBusy(false)
        return
      }
      const priv = await importPrivate(pkcs8)
      await saveKey(myId, priv, serverPub)
      setKeys({ priv, pub: serverPub })
      setStage('ready')
    } catch {
      setErr('Could not find your key backup. If you forgot your passphrase, you can reset encryption.')
    }
    setBusy(false)
  }

  if (stage === 'ready' && keys) return <ChatScreen session={session} keys={keys} />
  if (stage === 'loading') return <p style={{ padding: 20 }}>Loading...</p>

  if (stage === 'error') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="brand"><img src="/veil-icon.svg" alt="" /><h1>Veil</h1></div>
          <p className="info">{err}</p>
          <button className="primary" onClick={() => window.location.reload()}>Try again</button>
          <button className="link-btn" onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>
    )
  }

  const setupMode = stage === 'setup' || reset

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={setupMode ? setup : unlock}>
        <div className="brand">
          <img src="/veil-icon.svg" alt="" />
          <h1>{setupMode ? 'Protect your messages' : 'Unlock Veil'}</h1>
          <p>{setupMode ? 'Choose your Veil passphrase' : 'Enter your Veil passphrase'}</p>
        </div>

        {setupMode ? (
          <>
            <p className="gate-warn">
              Your passphrase locks your messages so only you and your contacts can read them. It is not your
              password and it never leaves your device. <b>If you forget it, your old messages cannot be recovered.</b>
              {reset && ' Resetting creates new keys, so your old messages will become unreadable.'}
            </p>
            <input type="password" placeholder="Passphrase (10+ characters)" value={pass}
                   onChange={(e) => setPass(e.target.value)} autoFocus />
            <input type="password" placeholder="Repeat passphrase" value={pass2}
                   onChange={(e) => setPass2(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand I cannot recover my messages if I forget it
            </label>
          </>
        ) : (
          <input type="password" placeholder="Passphrase" value={pass}
                 onChange={(e) => setPass(e.target.value)} autoFocus />
        )}

        <button className="primary" disabled={busy || !pass}>
          {busy ? 'Please wait...' : setupMode ? 'Create passphrase' : 'Unlock'}
        </button>
        {err && <p className="info">{err}</p>}

        {stage === 'unlock' && !reset && (
          <button type="button" className="link-btn" onClick={() => { setReset(true); setErr(''); setPass('') }}>
            Forgot your passphrase? Reset encryption
          </button>
        )}
        {reset && (
          <button type="button" className="link-btn" onClick={() => { setReset(false); setErr(''); setPass(''); setPass2('') }}>
            Back
          </button>
        )}
        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>Log out</button>
      </form>
    </div>
  )
}