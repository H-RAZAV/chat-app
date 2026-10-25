import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

export function useActivity(myId) {
  const [activity, setActivity] = useState({})
  const timers = useRef({})
  const chans = useRef({})
  const lastSent = useRef({})

  // show what someone is doing; it disappears by itself after 5 seconds of silence
  function set(id, kind) {
    clearTimeout(timers.current[id])
    setActivity((a) => {
      const n = { ...a }
      if (kind) n[id] = kind
      else delete n[id]
      return n
    })
    if (kind) timers.current[id] = setTimeout(() => set(id, null), 5000)
  }

  function getChan(toId) {
    if (!chans.current[toId]) {
      chans.current[toId] = new Promise((resolve) => {
        const ch = supabase.channel('activity:' + toId)
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve(ch)
        })
      })
    }
    return chans.current[toId]
  }

  // kind is 'typing', 'recording' or 'none'
  function sendActivity(toId, kind) {
    if (!toId) return
    const last = lastSent.current[toId]
    const now = Date.now()
    if (last && last.kind === kind && (kind === 'none' || now - last.at < 1500)) return
    lastSent.current[toId] = { kind, at: now }
    getChan(toId).then((ch) =>
      ch.send({ type: 'broadcast', event: 'act', payload: { from: myId, kind } })
    )
  }

  useEffect(() => {
    const ch = supabase
      .channel('activity:' + myId)
      .on('broadcast', { event: 'act' }, ({ payload }) =>
        set(payload.from, payload.kind === 'none' ? null : payload.kind)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(ch)
      Object.values(chans.current).forEach((p) => p.then((c) => supabase.removeChannel(c)))
      chans.current = {}
      Object.values(timers.current).forEach(clearTimeout)
    }
  }, [myId])

  return { activity, sendActivity, clearActivity: (id) => set(id, null) }
}