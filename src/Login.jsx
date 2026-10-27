import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setInfo('')
    setBusy(true)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setInfo(error.message)
    } else {
      const name = username.trim().toLowerCase()
      if (!/^[a-z0-9_]{3,20}$/.test(name)) {
        setInfo('Username must be 3-20 characters: letters, numbers or underscore only.')
        setBusy(false)
        return
      }
      const { data: free, error: checkErr } = await supabase.rpc('username_available', { u: name })
      if (checkErr) {
        setInfo(checkErr.message)
        setBusy(false)
        return
      }
      if (!free) {
        setInfo('That username is already taken. Try another one.')
        setBusy(false)
        return
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username: name } },
      })
      if (error) setInfo(error.message)
      else if (!data.session) setInfo('Account created. Check your email to confirm, then log in.')
    }
    setBusy(false)
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
           <div className="brand">
     <img src="/veil-icon.svg" alt="" />
     <h1>Veil</h1>
     <p>{mode === 'login' ? 'Welcome back' : 'Create your account'}</p>
   </div>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {mode === 'signup' && (
          <input placeholder="Username (e.g. ali_123)" value={username} onChange={(e) => setUsername(e.target.value)} required />
        )}
        <input type="password" placeholder="Password (min 6 characters)" value={password}
               onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <button className="primary" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
        {info && <p className="info">{info}</p>}
        <button type="button" className="link-btn"
                onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setInfo('') }}>
          {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  )
}