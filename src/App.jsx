import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <p style={{ padding: 20 }}>Loading...</p>
  return session ? <Chat session={session} /> : <Login />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState('')

  async function signUp() {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) setInfo(error.message)
    else if (!data.session) setInfo('Account created. Check your email to confirm, then log in.')
  }

  async function logIn() {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setInfo(error.message)
  }

  return (
    <div style={{ maxWidth: 320, margin: '80px auto', display: 'grid', gap: 8, padding: 16 }}>
      <h2>Chat App</h2>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password (min 6 characters)" type="password" value={password}
             onChange={(e) => setPassword(e.target.value)} />
      <button onClick={logIn}>Log in</button>
      <button onClick={signUp}>Sign up</button>
      <p>{info}</p>
    </div>
  )
}

function Chat({ session }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const bottomRef = useRef(null)
  const username = session.user.email.split('@')[0]

  useEffect(() => {
    supabase.from('messages').select('*')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setMessages((data || []).reverse()))

    const channel = supabase.channel('room')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => setMessages((m) => [...m, payload.new]))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(e) {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setText('')
    await supabase.from('messages').insert({ content, username })
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd' }}>
        <b>Chat as {username}</b>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {messages.map((m) => (
          <p key={m.id}><b>{m.username}:</b> {m.content}</p>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ddd' }}>
        <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)}
               placeholder="Type a message..." />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}