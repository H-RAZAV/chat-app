import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import ChatScreen from './ChatScreen'
import './App.css'

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
  return session ? <ChatScreen session={session} /> : <Login />
}