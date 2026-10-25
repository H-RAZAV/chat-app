import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Attachment from './Attachment'
import CallScreen from './CallScreen'
import Avatar from './Avatar'
import Settings from './Settings'
import ProfileView from './ProfileView'
import Icon from './Icon'
import { useCall } from './useCall'
import { useActivity } from './useActivity'
import { getTheme, applyTheme } from './theme'
import { playPing, unlockAudio, setBadge, showNotification } from './notify'

const MAX_SIZE = 25 * 1024 * 1024

const fmt = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function lastSeenText(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const yesterday = new Date()
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'last seen today at ' + fmt(ts)
  if (d.toDateString() === yesterday.toDateString()) return 'last seen yesterday at ' + fmt(ts)
  return 'last seen ' + d.toLocaleDateString() + ' at ' + fmt(ts)
}

function previewText(m) {
  if (!m.file_path) return m.content
  const t = m.file_type || ''
  if (t.startsWith('audio/')) return 'Voice message'
  if (t.startsWith('image/')) return 'Photo'
  if (t.startsWith('video/')) return 'Video'
  return m.file_name
}

function preview(m) {
  if (!m.file_path) return m.content
  const t = m.file_type || ''
  let icon = 'file'
  if (t.startsWith('audio/')) icon = 'mic'
  else if (t.startsWith('image/')) icon = 'image'
  else if (t.startsWith('video/')) icon = 'video'
  return (
    <span className="pv">
      <Icon name={icon} size={14} />
      {previewText(m)}
    </span>
  )
}

const nameOf = (p) => p?.display_name || p?.username || ''
const actText = (k) => (k === 'recording' ? 'recording audio...' : 'typing...')
const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')

export default function ChatScreen({ session }) {
  const myId = session.user.id
  const [me, setMe] = useState(null)
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState({})
  const [active, setActive] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [text, setText] = useState('')
  const [online, setOnline] = useState(new Set())
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [pending, setPending] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [theme, setTheme] = useState(getTheme())
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported')

  const prevOnline = useRef(new Set())
  const recRef = useRef(null)
  const fileRef = useRef(null)
  const bottomRef = useRef(null)
  const activeRef = useRef(null)
  activeRef.current = active

  const uploading = !!pending
  const myName = nameOf(me) || session.user.user_metadata?.username || 'someone'
  const { call, localStream, remoteStream, startCall, acceptCall, hangup } = useCall(myId, myName)
  const { activity, sendActivity, clearActivity } = useActivity(myId)

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  function addProfiles(list) {
    setProfiles((p) => {
      const n = { ...p }
      list.forEach((x) => (n[x.id] = x))
      return n
    })
  }

  async function fetchMessages() {
    const { data: msgs } = await supabase
      .from('messages').select('*')
      .order('created_at', { ascending: false }).limit(1000)
    const list = (msgs || []).reverse()
    setMessages(list)
    const ids = [...new Set(list.map((m) => (m.sender_id === myId ? m.receiver_id : m.sender_id)))]
    if (ids.length) {
      const { data: ps } = await supabase.from('profiles').select('*').in('id', ids)
      addProfiles(ps || [])
    }
  }

  // load my profile + messages, then listen for new messages
  useEffect(() => {
    async function load() {
      const { data: mine } = await supabase.from('profiles').select('*').eq('id', myId).single()
      setMe(mine)
      await fetchMessages()
    }
    load()

    const channel = supabase
      .channel('my-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

        const incoming = m.receiver_id === myId
        const screenHidden = document.visibilityState !== 'visible'
        const viewing = !screenHidden && activeRef.current === m.sender_id
        if (incoming) {
          clearActivity(m.sender_id)
          if (!viewing) playPing()
        }

        const otherId = incoming ? m.sender_id : m.receiver_id
        const { data } = await supabase.from('profiles').select('*').eq('id', otherId).single()
        if (data) addProfiles([data])

        if (incoming && screenHidden) {
          showNotification(nameOf(data) || 'New message', previewText(m), 'msg-' + m.sender_id, {
            from: m.sender_id,
          })
        }
      })
      .subscribe()

    // when the app comes back to the screen or the internet returns, catch up on missed messages
    const onVis = () => {
      const v = document.visibilityState === 'visible'
      setVisible(v)
      if (v) fetchMessages()
    }
    const onNet = () => fetchMessages()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onNet)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onNet)
      supabase.removeChannel(channel)
    }
  }, [myId])

  // sound needs one tap on the page before browsers allow it
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => window.removeEventListener('pointerdown', unlockAudio)
  }, [])

  // open a chat when someone taps a notification
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('chat')
    if (fromUrl) {
      setActive(fromUrl)
      window.history.replaceState({}, '', '/')
    }
    const onMsg = (e) => {
      if (e.data?.type === 'open-chat' && e.data.id) setActive(e.data.id)
    }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [])

  // unread counts per person
  const unread = useMemo(() => {
    const c = {}
    messages.forEach((m) => {
      if (m.receiver_id === myId && !m.read_at) c[m.sender_id] = (c[m.sender_id] || 0) + 1
    })
    return c
  }, [messages, myId])
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0)
  const activeUnread = unread[active] || 0

  // tab title and app icon badge
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Chat App` : 'Chat App'
    setBadge(totalUnread)
  }, [totalUnread])

  // messages in the open chat count as read while the app is on screen
  useEffect(() => {
    if (!active || !visible || !activeUnread) return
    supabase.rpc('mark_read', { other: active }).then(({ error }) => {
      if (error) return
      const now = new Date().toISOString()
      setMessages((prev) =>
        prev.map((m) =>
          m.sender_id === active && m.receiver_id === myId && !m.read_at ? { ...m, read_at: now } : m
        )
      )
    })
  }, [active, visible, activeUnread, myId])

  // online status (presence) + last seen
  useEffect(() => {
    const pres = supabase.channel('online-users', { config: { presence: { key: myId } } })
    pres
      .on('presence', { event: 'sync' }, () => {
        const now = new Set(Object.keys(pres.presenceState()))
        prevOnline.current.forEach((id) => {
          if (!now.has(id)) {
            setProfiles((p) =>
              p[id] ? { ...p, [id]: { ...p[id], last_seen: new Date().toISOString() } } : p
            )
          }
        })
        prevOnline.current = now
        setOnline(now)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await pres.track({ at: new Date().toISOString() })
      })

    const touch = () => {
      supabase.rpc('touch_last_seen').then(() => {})
    }
    touch()
    const timer = setInterval(touch, 30000)
    window.addEventListener('pagehide', touch)

    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', touch)
      supabase.removeChannel(pres)
    }
  }, [myId])

  // refresh the open person's profile (fresh last seen, photo, about)
  useEffect(() => {
    if (!active) return
    supabase.from('profiles').select('*').eq('id', active).single()
      .then(({ data }) => { if (data) addProfiles([data]) })
  }, [active])

  // search users by username
  useEffect(() => {
    const q = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!q) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles').select('*')
        .ilike('username', q + '%')
        .neq('id', myId)
        .limit(10)
      setResults(data || [])
    }, 250)
    return () => clearTimeout(t)
  }, [query, myId])

  // chat list: latest message per person
  const conversations = useMemo(() => {
    const map = {}
    messages.forEach((m) => {
      const other = m.sender_id === myId ? m.receiver_id : m.sender_id
      map[other] = m
    })
    return Object.entries(map)
      .map(([id, last]) => ({ id, last }))
      .sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
  }, [messages, myId])

  const chatMessages = messages.filter((m) => m.sender_id === active || m.receiver_id === active)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length, active, pending])

  function openChat(user) {
    addProfiles([user])
    setActive(user.id)
    setQuery('')
  }

  function onType(e) {
    const v = e.target.value
    setText(v)
    if (active) sendActivity(active, v.trim() ? 'typing' : 'none')
  }

  async function send(e) {
    e.preventDefault()
    const content = text.trim()
    if (!content || !active) return
    setText('')
    sendActivity(active, 'none')
    const { data, error } = await supabase
      .from('messages')
      .insert({ receiver_id: active, content })
      .select()
      .single()
    if (error) {
      alert(error.message)
      setText(content)
      return
    }
    setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]))
  }

  // upload a file or voice note, then send it as a message
  async function uploadAndSend(file, name, type, to, duration) {
    if (!to) return
    if (file.size > MAX_SIZE) {
      alert('File is too big. Maximum is 25 MB.')
      return
    }
    setPending({ to, name, voice: type.startsWith('audio/') && name.startsWith('voice-') })
    try {
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${myId}/${Date.now()}-${safe}`
      const { error: upErr } = await supabase.storage
        .from('chat-files')
        .upload(path, file, { contentType: type })
      if (upErr) {
        alert(upErr.message)
        return
      }
      const { data, error } = await supabase
        .from('messages')
        .insert({
          receiver_id: to,
          content: '',
          file_path: path,
          file_name: name,
          file_type: type,
          file_size: file.size,
          duration: duration || null,
        })
        .select()
        .single()
      if (error) {
        alert(error.message)
        return
      }
      setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]))
    } finally {
      setPending(null)
    }
  }

  function onPickFile(e) {
    const f = e.target.files[0]
    e.target.value = ''
    if (f) uploadAndSend(f, f.name, f.type || 'application/octet-stream', active)
  }

  // voice messages
  async function startRec() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert('Voice recording is not supported in this browser.')
      return
    }
    try {
      const to = active
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime =
        ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || ''
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const r = { recorder, chunks: [], cancelled: false, timer: null, act: null, start: Date.now() }

      recorder.ondataavailable = (e) => {
        if (e.data.size) r.chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        clearInterval(r.timer)
        clearInterval(r.act)
        sendActivity(to, 'none')
        setRecording(false)
        if (r.cancelled) return
        const type = (recorder.mimeType || 'audio/webm').split(';')[0]
        const ext = type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(r.chunks, { type })
        if (!blob.size) return
        const dur = Math.max(1, Math.round((Date.now() - r.start) / 1000))
        uploadAndSend(blob, `voice-${Date.now()}.${ext}`, type, to, dur)
      }

      recorder.start()
      setSecs(0)
      r.timer = setInterval(() => setSecs((s) => s + 1), 1000)
      sendActivity(to, 'recording')
      r.act = setInterval(() => sendActivity(to, 'recording'), 2000)
      recRef.current = r
      setRecording(true)
    } catch {
      alert('Please allow microphone access to record voice messages.')
    }
  }

  function stopRec(cancel) {
    const r = recRef.current
    if (!r) return
    r.cancelled = cancel
    r.recorder.stop()
  }

  // privacy: a person who hides their status shows no dot / last seen
  const hidden = (id) => !!profiles[id]?.hide_last_seen
  const showOnline = (id) => online.has(id) && !hidden(id)

  // calls (still work even if the person hides their status)
  function callPeer(video) {
    if (!online.has(active)) {
      alert(activeName + ' is offline. Calls work only when they have the app open.')
      return
    }
    startCall({ id: active, username: activeName }, video)
  }

  const activeName = nameOf(profiles[active])
  const statusText = hidden(active)
    ? ''
    : online.has(active)
    ? 'online'
    : lastSeenText(profiles[active]?.last_seen)
  const act = activity[active]

  return (
    <div className={'app' + (active ? ' chat-open' : '')}>
      {/* ---------- Left side: chat list ---------- */}
      <aside className="sidebar">
        <header className="bar">
          <div style={{ cursor: 'pointer' }} onClick={() => setShowSettings(true)}>
            <Avatar profile={me} />
          </div>
          <b>{nameOf(me)}</b>
          <button className="icon-btn" title={theme === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={21} />
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={21} />
          </button>
          <button className="icon-btn" title="Log out" onClick={() => supabase.auth.signOut()}>
            <Icon name="logout" size={21} />
          </button>
        </header>

        {perm === 'default' && (
          <div className="notice">
            <span>Get alerts for new messages</span>
            <button onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>
          </div>
        )}

        <div className="search">
          <input placeholder="Search username to start a chat"
                 value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="list">
          {query.trim() ? (
            results.length ? (
              results.map((u) => (
                <div key={u.id} className="item" onClick={() => openChat(u)}>
                  <Avatar profile={u} online={online.has(u.id) && !u.hide_last_seen} />
                  <div className="meta">
                    <div className="name">{nameOf(u)}</div>
                    <div className="sub">@{u.username}{u.about ? ' · ' + u.about : ''}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty">No user found</p>
            )
          ) : conversations.length ? (
            conversations.map(({ id, last }) => (
              <div key={id} className={'item' + (id === active ? ' active' : '')}
                   onClick={() => setActive(id)}>
                <Avatar profile={profiles[id]} online={showOnline(id)} />
                <div className="meta">
                  <div className="top">
                    <span className="name">{nameOf(profiles[id]) || '...'}</span>
                    <span className={'time' + (unread[id] ? ' new' : '')}>{fmt(last.created_at)}</span>
                  </div>
                  <div className="row2">
                    <div className={'last' + (activity[id] ? ' act' : '')}>
                      {activity[id] ? (
                        actText(activity[id])
                      ) : (
                        <>
                          {last.sender_id === myId ? 'You: ' : ''}
                          {preview(last)}
                        </>
                      )}
                    </div>
                    {unread[id] > 0 && <span className="badge">{unread[id] > 99 ? '99+' : unread[id]}</span>}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="empty">No chats yet. Search for a username above to start chatting.</p>
          )}
        </div>
      </aside>

      {/* ---------- Right side: open chat ---------- */}
      <main className="chat">
        {active ? (
          <>
            <header className="bar">
              <button className="back" onClick={() => setActive(null)}>
                <Icon name="back" size={22} />
              </button>
              <div className="head-click" title="View contact info" onClick={() => setShowProfile(true)}>
                <Avatar profile={profiles[active]} online={showOnline(active)} />
                <div className="who">
                  <b>{activeName}</b>
                  <small className={act ? 'act' : ''}>{act ? actText(act) : statusText}</small>
                </div>
              </div>
              <button className="icon-btn" title="Video call" onClick={() => callPeer(true)}>
                <Icon name="video" size={22} />
              </button>
              <button className="icon-btn" title="Voice call" onClick={() => callPeer(false)}>
                <Icon name="phone" size={20} />
              </button>
            </header>

            <div className="messages">
              {chatMessages.map((m) => (
                <div key={m.id} className={'bubble ' + (m.sender_id === myId ? 'me' : 'them')}>
                  {m.file_path && <Attachment m={m} />}
                  {m.content}
                  <span className="t">{fmt(m.created_at)}</span>
                </div>
              ))}
              {pending && pending.to === active && (
                <div className="bubble me sending">
                  <span className="dots"><i /><i /><i /></span>
                  {pending.voice ? 'Sending voice message' : 'Sending ' + pending.name}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {recording ? (
              <div className="composer">
                <button type="button" className="gray" title="Cancel" onClick={() => stopRec(true)}>
                  <Icon name="trash" size={20} />
                </button>
                <div className="rec">
                  <span className="rec-dot" />
                  <span className="rec-bars"><i /><i /><i /><i /><i /></span>
                  {mmss(secs)}
                </div>
                <button type="button" title="Send" onClick={() => stopRec(false)}>
                  <Icon name="send" size={20} />
                </button>
              </div>
            ) : (
              <form className="composer" onSubmit={send}>
                <button type="button" className="gray" title="Attach file" disabled={uploading}
                        onClick={() => fileRef.current.click()}>
                  <Icon name="paperclip" size={20} />
                </button>
                <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
                <input value={text} onChange={onType}
                       placeholder={uploading ? 'Sending...' : 'Type a message'} />
                {text.trim() ? (
                  <button key="send" type="submit" className="swap" title="Send">
                    <Icon name="send" size={20} />
                  </button>
                ) : (
                  <button key="mic" type="button" className="swap" title="Record voice message"
                          disabled={uploading} onClick={startRec}>
                    <Icon name="mic" size={20} />
                  </button>
                )}
              </form>
            )}
          </>
        ) : (
          <div className="placeholder">
            <h2>Your chat app</h2>
            <p>Search a username on the left to start a conversation.</p>
          </div>
        )}
      </main>

      <CallScreen call={call} localStream={localStream} remoteStream={remoteStream}
                  onAccept={acceptCall} onHangup={hangup} />

      {showSettings && me && (
        <Settings me={me} onClose={() => setShowSettings(false)} onSaved={(p) => setMe(p)} />
      )}

      {showProfile && active && profiles[active] && (
        <ProfileView profile={profiles[active]} status={statusText} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}