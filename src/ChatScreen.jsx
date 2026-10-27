import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import Attachment from './Attachment'
import MediaViewer from './MediaViewer'
import CallScreen from './CallScreen'
import Avatar from './Avatar'
import Settings from './Settings'
import ProfileView from './ProfileView'
import Appearance from './Appearance'
import AdminPanel from './AdminPanel'
import { Name } from './Verified'
import Icon from './Icon'
import { useCall } from './useCall'
import { useActivity } from './useActivity'
import { playPing, unlockAudio, setBadge, showNotification } from './notify'
import { derivePairKey, sealJson, openJson, sealBytes, clearKey } from './crypto'

const MAX_SIZE = 25 * 1024 * 1024 - 1024 // a little room for the encryption overhead

const fmt = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// ---------- dates ----------
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const daysAgo = (ts) => Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000)
const sameDay = (a, b) => startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime()

function dayLabel(ts) {
  const n = daysAgo(ts)
  if (n === 0) return 'Today'
  if (n === 1) return 'Yesterday'
  if (n > 1 && n < 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' })
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
}

function listTime(ts) {
  const n = daysAgo(ts)
  if (n === 0) return fmt(ts)
  if (n === 1) return 'Yesterday'
  if (n > 1 && n < 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' })
  return new Date(ts).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function lastSeenText(ts) {
  if (!ts) return ''
  const n = daysAgo(ts)
  if (n === 0) return 'last seen today at ' + fmt(ts)
  if (n === 1) return 'last seen yesterday at ' + fmt(ts)
  return 'last seen ' + new Date(ts).toLocaleDateString() + ' at ' + fmt(ts)
}

function previewText(m) {
  if (m.locked) return "Message can't be decrypted"
  if (!m.file_path) return m.content
  const t = m.file_type || ''
  if (t.startsWith('audio/')) return 'Voice message'
  if (t.startsWith('image/')) return 'Photo'
  if (t.startsWith('video/')) return 'Video'
  return m.file_name
}

function preview(m) {
  if (m.locked) {
    return (
      <span className="pv">
        <Icon name="lock" size={14} />
        {previewText(m)}
      </span>
    )
  }
  if (m.is_broadcast) {
    return (
      <span className="pv">
        <Icon name="megaphone" size={14} />
        {m.content}
      </span>
    )
  }
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

const isMedia = (m) =>
  !!m.file_path && ((m.file_type || '').startsWith('image/') || (m.file_type || '').startsWith('video/'))

// sent, delivered, read
function Ticks({ m, size = 16 }) {
  if (m.read_at) return <Icon name="checkAll" size={size} className="tick read" />
  if (m.delivered_at) return <Icon name="checkAll" size={size} className="tick" />
  return <Icon name="check" size={size} className="tick" />
}

const nameOf = (p) => p?.display_name || p?.username || ''
const actText = (k) => (k === 'recording' ? 'recording audio...' : 'typing...')
const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')

export default function ChatScreen({ session, keys }) {
  const myId = session.user.id
  const [me, setMe] = useState(null)
  const [official, setOfficial] = useState(null)
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
  const [showAppearance, setShowAppearance] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [viewer, setViewer] = useState(null)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported')

  const prevOnline = useRef(new Set())
  const recRef = useRef(null)
  const fileRef = useRef(null)
  const bottomRef = useRef(null)
  const activeRef = useRef(null)
  activeRef.current = active
  const profilesRef = useRef({})
  profilesRef.current = profiles
  const pairKeys = useRef({})

  const uploading = !!pending
  const myName = nameOf(me) || session.user.user_metadata?.username || 'someone'
  const {
    call, people, localStream, media, facing, canFlip, notice,
    startCall, acceptCall, hangup, toggleMic, toggleCam, flipCamera, inviteMore,
  } = useCall(myId, myName, !!me?.is_official) // the official account never receives calls
  const { activity, sendActivity, clearActivity } = useActivity(myId)

  async function logout() {
    try {
      await clearKey(myId) // the key is removed from this device
    } catch {
      /* ignore */
    }
    supabase.auth.signOut()
  }

  function addProfiles(list) {
    setProfiles((p) => {
      const n = { ...p }
      list.forEach((x) => (n[x.id] = x))
      return n
    })
  }

  // ---------- encryption ----------
  function getPairKey(profile) {
    const pub = profile?.public_key
    if (!pub) return null
    const id = profile.id + ':' + pub
    if (!pairKeys.current[id]) pairKeys.current[id] = derivePairKey(keys.priv, keys.pub, pub)
    return pairKeys.current[id]
  }

  // turns an encrypted row from the database into a readable message
  async function decryptMsg(m, profileMap) {
    if (!m.enc) return m // old message from before encryption
    const otherId = m.sender_id === myId ? m.receiver_id : m.sender_id
    try {
      const key = await getPairKey(profileMap[otherId])
      if (!key) throw new Error('no key')
      const data = await openJson(key, m.sender_id + '|' + m.receiver_id, m.enc)
      const out = { ...m, content: data.t || '' }
      if (data.f) {
        out.file_name = data.f.n
        out.file_type = data.f.y
        out.file_size = data.f.s
        out.duration = data.f.d || null
        out.file_key = data.f.k
      }
      return out
    } catch {
      return { ...m, content: '', locked: true }
    }
  }

  async function encryptFor(to, obj) {
    const key = await getPairKey(profilesRef.current[to])
    return sealJson(key, myId + '|' + to, obj)
  }

  // make sure the other person has set up encryption
  async function ensurePeerKey(id) {
    let p = profilesRef.current[id]
    if (!p?.public_key) {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
      if (data) {
        p = data
        profilesRef.current[id] = data
        addProfiles([data])
      }
    }
    if (!p?.public_key) {
      alert((nameOf(p) || 'This person') + ' has not set up encryption yet. Ask them to open Veil and finish the setup, then try again.')
      return false
    }
    return true
  }

  function markDelivered() {
    supabase.rpc('mark_delivered').then(() => {})
  }

  async function fetchMessages() {
    const { data: msgs } = await supabase
      .from('messages').select('*')
      // announcements you sent are not shown in your own chat list
      .or(`is_broadcast.eq.false,sender_id.neq.${myId}`)
      .order('created_at', { ascending: false }).limit(1000)
    const raw = (msgs || []).reverse()
    const map = { ...profilesRef.current }
    const ids = [...new Set(raw.map((m) => (m.sender_id === myId ? m.receiver_id : m.sender_id)))]
    if (ids.length) {
      const { data: ps } = await supabase.from('profiles').select('*').in('id', ids)
      ;(ps || []).forEach((p) => (map[p.id] = p))
      addProfiles(ps || [])
    }
    const list = await Promise.all(raw.map((m) => decryptMsg(m, map)))
    setMessages(list)
    if (list.some((m) => m.receiver_id === myId && !m.delivered_at)) markDelivered()
  }

  // load my profile + messages, then listen for new messages and status changes
  useEffect(() => {
    async function load() {
      const { data: mine } = await supabase.from('profiles').select('*').eq('id', myId).single()
      setMe(mine)
      const { data: off } = await supabase.from('profiles').select('*').eq('is_official', true).limit(1).maybeSingle()
      if (off) {
        setOfficial(off)
        addProfiles([off])
      }
      await fetchMessages()
    }
    load()

    const channel = supabase
      .channel('my-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const raw = payload.new
        if (raw.is_broadcast && raw.sender_id === myId) return // our own announcement copies

        const incoming = raw.receiver_id === myId
        const screenHidden = document.visibilityState !== 'visible'
        const viewing = !screenHidden && activeRef.current === raw.sender_id
        if (incoming) {
          markDelivered()
          clearActivity(raw.sender_id)
          if (!viewing) playPing()
        }

        const otherId = incoming ? raw.sender_id : raw.receiver_id
        let p = profilesRef.current[otherId]
        if (!p || !p.public_key) {
          const { data } = await supabase.from('profiles').select('*').eq('id', otherId).single()
          if (data) {
            p = data
            profilesRef.current[otherId] = data
            addProfiles([data])
          }
        }

        const m = await decryptMsg(raw, { [otherId]: p })
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))

        if (incoming && screenHidden) {
          showNotification(nameOf(p) || 'Veil', previewText(m), 'msg-' + raw.sender_id, {
            from: raw.sender_id,
          })
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const n = payload.new
        // only the ticks change; never overwrite the decrypted text
        setMessages((prev) =>
          prev.map((m) => (m.id === n.id ? { ...m, read_at: n.read_at, delivered_at: n.delivered_at } : m))
        )
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
    document.title = totalUnread ? `(${totalUnread}) Veil` : 'Veil'
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
          m.sender_id === active && m.receiver_id === myId && !m.read_at
            ? { ...m, read_at: now, delivered_at: m.delivered_at || now }
            : m
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

  // refresh the open person's profile (fresh last seen, photo, about, ticks)
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

  // the official Veil account is always pinned at the top for everyone else
  const chatList = useMemo(() => {
    if (!official || official.id === myId) return conversations
    const own = conversations.find((c) => c.id === official.id)
    return [own || { id: official.id, last: null }, ...conversations.filter((c) => c.id !== official.id)]
  }, [conversations, official, myId])

  const chatMessages = messages.filter((m) => m.sender_id === active || m.receiver_id === active)
  const mediaItems = chatMessages.filter(isMedia)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length, active, pending])

  // photo and video viewer: the phone's back button closes it instead of leaving Veil
  const viewerOpen = viewer !== null
  useEffect(() => {
    if (!viewerOpen) return
    window.history.pushState({ veilViewer: true }, '')
    const onPop = () => setViewer(null)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state && window.history.state.veilViewer) window.history.back()
    }
  }, [viewerOpen])

  function openViewer(m) {
    const i = mediaItems.findIndex((x) => x.id === m.id)
    if (i >= 0) setViewer(i)
  }

  function openChat(user) {
    profilesRef.current[user.id] = user
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
    const to = active
    if (!(await ensurePeerKey(to))) return
    setText('')
    sendActivity(to, 'none')
    try {
      const encrypted = await encryptFor(to, { t: content })
      const { data, error } = await supabase
        .from('messages')
        .insert({ receiver_id: to, content: '', enc: encrypted })
        .select()
        .single()
      if (error) throw error
      const m = { ...data, content }
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    } catch (err) {
      alert(err.message || 'Could not send the message.')
      setText(content)
    }
  }

  // encrypt a file or voice note, upload it, then send the key inside an encrypted message
  async function uploadAndSend(file, name, type, to, duration) {
    if (!to) return
    if (file.size > MAX_SIZE) {
      alert('File is too big. Maximum is 25 MB.')
      return
    }
    if (!(await ensurePeerKey(to))) return
    setPending({ to, name, voice: type.startsWith('audio/') && name.startsWith('voice-') })
    try {
      const sealed = await sealBytes(await file.arrayBuffer())
      const path = `${myId}/${crypto.randomUUID()}`
      const { error: upErr } = await supabase.storage
        .from('chat-files')
        .upload(path, sealed.blob, { contentType: 'application/octet-stream' })
      if (upErr) {
        alert(upErr.message)
        return
      }
      const encrypted = await encryptFor(to, {
        t: '',
        f: { n: name, y: type, s: file.size, d: duration || null, k: sealed.key },
      })
      const { data, error } = await supabase
        .from('messages')
        .insert({ receiver_id: to, content: '', enc: encrypted, file_path: path })
        .select()
        .single()
      if (error) {
        alert(error.message)
        return
      }
      const m = {
        ...data,
        content: '',
        file_name: name,
        file_type: type,
        file_size: file.size,
        duration: duration || null,
        file_key: sealed.key,
      }
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    } catch (err) {
      alert(err.message || 'Could not send the file.')
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
      alert(activeName + ' is offline. Calls work only when they have Veil open.')
      return
    }
    startCall([{ id: active, username: activeName }], video)
  }

  // people you can add to a call: your chats who are online right now
  const callContacts = conversations
    .filter(({ id }) => online.has(id) && profiles[id] && !profiles[id].is_official)
    .map(({ id }) => ({ id, username: nameOf(profiles[id]), profile: profiles[id] }))

  const activeName = nameOf(profiles[active])
  const peerIsOfficial = !!profiles[active]?.is_official
  const statusText = peerIsOfficial
    ? 'Official account'
    : hidden(active)
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
          <b><Name p={me} /></b>
          {me?.is_official && (
            <button className="icon-btn" title="Veil admin" onClick={() => setShowAdmin(true)}>
              <Icon name="shield" size={21} />
            </button>
          )}
          <button className="icon-btn" title="Appearance" onClick={() => setShowAppearance(true)}>
            <Icon name="palette" size={21} />
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>
            <Icon name="settings" size={21} />
          </button>
          <button className="icon-btn" title="Log out" onClick={logout}>
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
                    <div className="name"><Name p={u} /></div>
                    <div className="sub">@{u.username}{u.about ? ' · ' + u.about : ''}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="empty">No user found</p>
            )
          ) : chatList.length ? (
            chatList.map(({ id, last }) => {
              const isOfficial = official && id === official.id && official.id !== myId
              return (
                <div key={id} className={'item' + (id === active ? ' active' : '') + (isOfficial ? ' pinned' : '')}
                     onClick={() => setActive(id)}>
                  <Avatar profile={profiles[id]} online={showOnline(id) && !isOfficial} />
                  <div className="meta">
                    <div className="top">
                      <span className="name"><Name p={profiles[id]} /></span>
                      {last && <span className={'time' + (unread[id] ? ' new' : '')}>{listTime(last.created_at)}</span>}
                    </div>
                    <div className="row2">
                      <div className={'last' + (activity[id] ? ' act' : '')}>
                        {activity[id] ? (
                          actText(activity[id])
                        ) : last ? (
                          <>
                            {last.sender_id === myId && <Ticks m={last} size={15} />}
                            {preview(last)}
                          </>
                        ) : (
                          'Support and updates. Message us anytime.'
                        )}
                      </div>
                      {unread[id] > 0 && <span className="badge">{unread[id] > 99 ? '99+' : unread[id]}</span>}
                    </div>
                  </div>
                </div>
              )
            })
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
              <div className="head-click" title="View contact info and security code" onClick={() => setShowProfile(true)}>
                <Avatar profile={profiles[active]} online={showOnline(active) && !peerIsOfficial} />
                <div className="who">
                  <b><Name p={profiles[active]} /></b>
                  <small className={act ? 'act' : ''}>{act ? actText(act) : statusText}</small>
                </div>
              </div>
              {!peerIsOfficial && (
                <>
                  <button className="icon-btn" title="Video call" onClick={() => callPeer(true)}>
                    <Icon name="video" size={22} />
                  </button>
                  <button className="icon-btn" title="Voice call" onClick={() => callPeer(false)}>
                    <Icon name="phone" size={20} />
                  </button>
                </>
              )}
            </header>

            <div className="messages">
              <div className="enc-note">
                <Icon name="lock" size={13} />
                <span>
                  Messages and files in this chat are end-to-end encrypted. Tap the name above to check the security code.
                </span>
              </div>
              {chatMessages.map((m, i) => (
                <Fragment key={m.id}>
                  {(i === 0 || !sameDay(chatMessages[i - 1].created_at, m.created_at)) && (
                    <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>
                  )}
                  <div className={'bubble ' + (m.sender_id === myId ? 'me' : 'them')}>
                    {m.locked ? (
                      <span className="locked"><Icon name="lock" size={13} /> Can't decrypt this message</span>
                    ) : (
                      <>
                        {m.is_broadcast && (
                          <div className="bcast"><Icon name="megaphone" size={13} /> Announcement</div>
                        )}
                        {m.file_path && <Attachment m={m} onOpen={() => openViewer(m)} />}
                        {m.content}
                      </>
                    )}
                    <span className="t">
                      {fmt(m.created_at)}
                      {m.sender_id === myId && <Ticks m={m} />}
                    </span>
                  </div>
                </Fragment>
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
                <input value={text} onChange={onType} maxLength={2000}
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
            <img src="/veil-icon.svg" alt="Veil" />
            <h2>Veil</h2>
            <p>Search a username on the left to start a conversation.</p>
          </div>
        )}
      </main>

      <CallScreen
        call={call} people={people} localStream={localStream} media={media} facing={facing}
        canFlip={canFlip} notice={notice} contacts={callContacts}
        onAccept={acceptCall} onHangup={hangup} onToggleMic={toggleMic} onToggleCam={toggleCam}
        onFlip={flipCamera} onInvite={inviteMore}
      />

      {viewer !== null && mediaItems[viewer] && (
        <MediaViewer
          items={mediaItems}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          titleOf={(m) => (m.sender_id === myId ? 'You' : nameOf(profiles[m.sender_id]))}
        />
      )}

      {showSettings && me && (
        <Settings me={me} onClose={() => setShowSettings(false)} onSaved={(p) => setMe(p)} />
      )}

      {showAppearance && <Appearance onClose={() => setShowAppearance(false)} />}

      {showAdmin && me?.is_official && (
        <AdminPanel
          myId={myId}
          keys={keys}
          onClose={() => setShowAdmin(false)}
          onOpenChat={(u) => { openChat(u); setShowAdmin(false) }}
        />
      )}

      {showProfile && active && profiles[active] && (
        <ProfileView
          profile={profiles[active]}
          status={statusText}
          myKey={keys.pub}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  )
}