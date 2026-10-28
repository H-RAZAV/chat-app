import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

const MAX_PEOPLE = 5 // including you

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

// screen sharing works in desktop browsers only
export const canShareScreen =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// accepts "name", "name.metered.live" or "https://name.metered.live/"
function meteredHost() {
  let app = (import.meta.env.VITE_METERED_APP || '').trim()
  app = app.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (app && !app.includes('.')) app += '.metered.live'
  return app
}

// ask Metered for relay (TURN) servers
async function getIce() {
  const host = meteredHost()
  const key = (import.meta.env.VITE_METERED_KEY || '').trim()
  const config = { iceServers: STUN }
  if (new URLSearchParams(window.location.search).has('relay')) config.iceTransportPolicy = 'relay'

  let relayCount = 0
  let problem = ''
  if (!host || !key) {
    problem = 'missing'
  } else {
    try {
      const res = await fetch(`https://${host}/api/v1/turn/credentials?apiKey=${key}`)
      const list = await res.json()
      if (Array.isArray(list) && list.length) {
        config.iceServers = [...STUN, ...list]
        relayCount = list.length
      } else {
        problem = 'rejected'
      }
    } catch {
      problem = 'unreachable'
    }
  }
  console.log('[call] relay servers loaded:', relayCount, problem)
  return { config, relayCount, problem }
}

function failText(ice) {
  if (ice?.problem === 'missing')
    return 'Call failed: the relay server is not set up. VITE_METERED_APP or VITE_METERED_KEY is missing in this version of the app.'
  if (ice?.problem === 'rejected')
    return 'Call failed: Metered refused the request. Check the app name and the API key.'
  if (ice?.problem === 'unreachable')
    return 'Call failed: could not reach the Metered relay server. Check the app name and your internet.'
  return 'The call could not connect, even with the relay server. Check that your Metered account is active and has free data left.'
}

async function getMedia(video) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user' } : false,
    })
  } catch {
    alert('Please allow microphone' + (video ? ' and camera' : '') + ' access to use calls.')
    return null
  }
}

export function useCall(myId, myName, blockIncoming = false) {
  const [call, setCall] = useState(null)
  const [people, setPeople] = useState({})
  const [localStream, setLocalStream] = useState(null)
  const [localScreen, setLocalScreen] = useState(null)
  const [media, setMedia] = useState({ mic: true, cam: true })
  const [facing, setFacing] = useState('user')
  const [canFlip, setCanFlip] = useState(false)
  const [notice, setNotice] = useState('')

  const blockRef = useRef(blockIncoming)
  blockRef.current = blockIncoming
  const nameRef = useRef(myName)
  nameRef.current = myName

  const callRef = useRef(null)
  const peers = useRef({})
  const local = useRef(null)
  const screenRef = useRef(null)
  const pendingScreen = useRef({})
  const invite = useRef(null)
  const invited = useRef(new Set())
  const names = useRef({})
  const earlyIce = useRef({})
  const iceInfo = useRef(null)
  const sendChans = useRef({})
  const ringTimer = useRef(null)
  const noticeTimer = useRef(null)
  const mediaRef = useRef({ mic: true, cam: true })

  function updateCall(c) {
    callRef.current = c
    setCall(c)
  }

  function tell(text) {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 4000)
  }

  // one sending channel per person we talk to
  function getSendChannel(toId) {
    if (!sendChans.current[toId]) {
      sendChans.current[toId] = new Promise((resolve) => {
        const ch = supabase.channel('calls:' + toId)
        ch.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve(ch)
        })
      })
    }
    return sendChans.current[toId]
  }

  function signal(toId, payload) {
    const msg = { room: callRef.current?.room, ...payload, from: myId, fromName: nameRef.current }
    getSendChannel(toId).then((ch) => ch.send({ type: 'broadcast', event: 'signal', payload: msg }))
  }

  function cleanup() {
    clearTimeout(ringTimer.current)
    Object.values(peers.current).forEach((e) => {
      clearTimeout(e.timer)
      e.pc.onicecandidate = null
      e.pc.ontrack = null
      e.pc.onconnectionstatechange = null
      e.pc.onsignalingstatechange = null
      e.pc.close()
    })
    peers.current = {}
    screenRef.current?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    screenRef.current = null
    pendingScreen.current = {}
    setLocalScreen(null)
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
    invite.current = null
    invited.current = new Set()
    earlyIce.current = {}
    names.current = {}
    mediaRef.current = { mic: true, cam: true }
    setMedia({ mic: true, cam: true })
    setFacing('user')
    setCanFlip(false)
    setPeople({})
    setLocalStream(null)
    updateCall(null)
  }

  function hangup() {
    const c = callRef.current
    if (c) {
      if (c.status === 'incoming') signal(c.inviterId, { type: 'decline', room: c.room })
      else {
        Object.keys(peers.current).forEach((id) => signal(id, { type: 'leave' }))
        invited.current.forEach((id) => signal(id, { type: 'leave' }))
      }
    }
    cleanup()
  }

  function startRing() {
    clearTimeout(ringTimer.current)
    ringTimer.current = setTimeout(() => {
      if (callRef.current && Object.keys(peers.current).length === 0) {
        alert('No answer.')
        hangup()
      }
    }, 45000)
  }

  function flushPending(e) {
    e.pending.splice(0).forEach((c) => e.pc.addIceCandidate(c).catch(() => {}))
  }

  // works out which of a person's streams is their camera and which is their screen
  function syncStreams(id) {
    const e = peers.current[id]
    if (!e) return
    const live = Object.values(e.streams).filter((s) => s.getTracks().length > 0)
    const screen = e.screenId ? live.find((s) => s.id === e.screenId) || null : null
    const cam = live.find((s) => s.id !== e.screenId) || null
    setPeople((ps) => (ps[id] ? { ...ps, [id]: { ...ps[id], stream: cam, screen } } : ps))
  }

  function removePeer(id) {
    const e = peers.current[id]
    if (!e) return
    clearTimeout(e.timer)
    e.pc.onconnectionstatechange = null
    e.pc.onsignalingstatechange = null
    e.pc.close()
    delete peers.current[id]
    setPeople((ps) => {
      const n = { ...ps }
      delete n[id]
      return n
    })
  }

  function peerFailed(id) {
    const name = names.current[id] || 'Someone'
    removePeer(id)
    if (Object.keys(peers.current).length === 0 && invited.current.size === 0) {
      alert(failText(iceInfo.current))
      hangup()
    } else {
      tell(name + ' could not connect')
    }
  }

  // keeps the shared screen sharp but not too heavy
  function tune(e) {
    if (!e.screenSender) return
    try {
      const p = e.screenSender.getParameters()
      if (!p.encodings || !p.encodings.length) p.encodings = [{}]
      p.encodings[0].maxBitrate = 1500000
      e.screenSender.setParameters(p).catch(() => {})
    } catch {
      /* ignore */
    }
  }

  function addPeer(id, name) {
    if (peers.current[id]) return peers.current[id]
    if (name) names.current[id] = name

    const pc = new RTCPeerConnection(iceInfo.current.config)
    const entry = {
      pc, pending: earlyIce.current[id] || [], remote: false, queue: [], ready: false, timer: null,
      making: false, dirty: false, rosterSent: false, screenSender: null,
      screenId: pendingScreen.current[id] || null, streams: {},
    }
    delete earlyIce.current[id]
    delete pendingScreen.current[id]
    peers.current[id] = entry

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const c = e.candidate.toJSON()
      if (entry.ready) signal(id, { type: 'ice', candidate: c })
      else entry.queue.push(c)
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (!stream) return
      entry.streams[stream.id] = stream
      syncStreams(id)
    }
    // if something changed while negotiating (for example a screen share), do it again when ready
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable' && entry.dirty) setTimeout(() => renegotiate(id), 0)
    }
    pc.onconnectionstatechange = () => {
      console.log('[call]', id.slice(0, 6), pc.connectionState)
      if (pc.connectionState === 'connected') {
        clearTimeout(entry.timer)
        clearTimeout(ringTimer.current)
        setPeople((ps) => (ps[id] ? { ...ps, [id]: { ...ps[id], state: 'connected' } } : ps))
        if (callRef.current) updateCall({ ...callRef.current, status: 'active' })
        signal(id, { type: 'state', ...mediaRef.current })
      } else if (pc.connectionState === 'failed') {
        peerFailed(id)
      }
    }
    entry.timer = setTimeout(() => {
      if (peers.current[id] === entry && pc.connectionState !== 'connected') peerFailed(id)
    }, 25000)

    local.current.getTracks().forEach((t) => pc.addTrack(t, local.current))

    // somebody is already sharing their screen: this new person gets it too
    if (screenRef.current) {
      const track = screenRef.current.getVideoTracks()[0]
      if (track) {
        signal(id, { type: 'screen', on: true, sid: screenRef.current.id })
        entry.screenSender = pc.addTrack(track, screenRef.current)
        entry.dirty = true
      }
    }

    setPeople((ps) => ({
      ...ps,
      [id]: { id, name: names.current[id] || 'Participant', stream: null, screen: null, state: 'connecting', cam: true, mic: true },
    }))
    invited.current.delete(id)
    return entry
  }

  async function makeOffer(id) {
    const e = peers.current[id]
    if (!e) return
    e.making = true
    try {
      const offer = await e.pc.createOffer()
      await e.pc.setLocalDescription(offer)
      signal(id, { type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
      e.ready = true
      e.queue.splice(0).forEach((cand) => signal(id, { type: 'ice', candidate: cand }))
      tune(e)
    } finally {
      e.making = false
    }
  }

  // a new offer for a call that is already running (adding or removing a screen share)
  async function renegotiate(id) {
    const e = peers.current[id]
    if (!e) return
    if (!e.pc.remoteDescription || e.pc.signalingState !== 'stable' || e.making) {
      e.dirty = true
      return
    }
    e.dirty = false
    e.making = true
    try {
      const offer = await e.pc.createOffer()
      if (e.pc.signalingState !== 'stable') {
        e.dirty = true
        return
      }
      await e.pc.setLocalDescription(offer)
      signal(id, { type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
      tune(e)
    } catch {
      /* ignore */
    } finally {
      e.making = false
    }
  }

  // the person with the smaller id always makes the first offer, so two people never offer at once
  function connectTo(id, name) {
    if (id === myId || peers.current[id] || !local.current) return
    if (Object.keys(peers.current).length + 1 >= MAX_PEOPLE) return
    addPeer(id, name)
    if (myId < id) makeOffer(id).catch(() => {})
    else signal(id, { type: 'hello' })
  }

  function attachLocal(stream, video) {
    local.current = stream
    setLocalStream(stream)
    mediaRef.current = { mic: true, cam: !!video }
    setMedia(mediaRef.current)
    const t = stream.getVideoTracks()[0]
    setFacing(t?.getSettings?.().facingMode === 'environment' ? 'environment' : 'user')
    if (video) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((d) => setCanFlip(d.filter((x) => x.kind === 'videoinput').length > 1))
        .catch(() => {})
    }
  }

  async function startCall(list, video) {
    if (callRef.current) return
    const room = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random()
    updateCall({ room, video, status: 'calling', title: list.map((p) => p.username).join(', ') })
    const stream = await getMedia(video)
    if (!stream) return cleanup()
    if (!callRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    attachLocal(stream, video)
    iceInfo.current = await getIce()
    if (!callRef.current) return
    list.forEach((p) => {
      names.current[p.id] = p.username
      invited.current.add(p.id)
      signal(p.id, { type: 'invite', video, members: [{ id: myId, name: nameRef.current }] })
    })
    startRing()
  }

  // invite another person while already in a call
  function inviteMore(p) {
    const c = callRef.current
    if (!c || !local.current || c.status === 'incoming') return
    if (invited.current.has(p.id) || peers.current[p.id]) return
    if (Object.keys(peers.current).length + invited.current.size + 1 >= MAX_PEOPLE) {
      tell('A call can have up to ' + MAX_PEOPLE + ' people.')
      return
    }
    names.current[p.id] = p.username
    invited.current.add(p.id)
    const members = [
      { id: myId, name: nameRef.current },
      ...Object.keys(peers.current).map((id) => ({ id, name: names.current[id] || 'Participant' })),
    ]
    signal(p.id, { type: 'invite', video: c.video, members })
    tell('Calling ' + p.username + '...')
  }

  async function acceptCall() {
    const inv = invite.current
    const c = callRef.current
    if (!inv || !c || c.status !== 'incoming') return
    clearTimeout(ringTimer.current)
    updateCall({ ...c, status: 'calling', title: c.inviterName })
    const stream = await getMedia(inv.video)
    if (!stream) {
      signal(inv.from, { type: 'decline', room: inv.room })
      return cleanup()
    }
    if (!callRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    attachLocal(stream, inv.video)
    iceInfo.current = await getIce()
    if (!callRef.current) return
    ;(inv.members || []).forEach((m) => connectTo(m.id, m.name))
    clearTimeout(ringTimer.current)
    ringTimer.current = setTimeout(() => {
      if (callRef.current && Object.keys(peers.current).length === 0) {
        alert('The call has already ended.')
        hangup()
      }
    }, 25000)
  }

  function broadcastState() {
    Object.keys(peers.current).forEach((id) => signal(id, { type: 'state', ...mediaRef.current }))
  }

  function toggleMic() {
    const t = local.current?.getAudioTracks()[0]
    if (!t) return
    t.enabled = !t.enabled
    mediaRef.current = { ...mediaRef.current, mic: t.enabled }
    setMedia(mediaRef.current)
    broadcastState()
  }

  function toggleCam() {
    const t = local.current?.getVideoTracks()[0]
    if (!t) return
    t.enabled = !t.enabled
    mediaRef.current = { ...mediaRef.current, cam: t.enabled }
    setMedia(mediaRef.current)
    broadcastState()
  }

  // front / back camera
  async function flipCamera() {
    const stream = local.current
    const old = stream?.getVideoTracks()[0]
    if (!stream || !old) return
    const next = facing === 'user' ? 'environment' : 'user'
    const wasOn = old.enabled

    async function open(mode) {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      })
      const track = s.getVideoTracks()[0]
      track.enabled = wasOn
      stream.addTrack(track)
      Object.values(peers.current).forEach((e) => {
        // never touch the screen-share sender
        const sender = e.pc.getSenders().find((x) => x !== e.screenSender && x.track && x.track.kind === 'video')
        if (sender) sender.replaceTrack(track)
      })
      setFacing(mode)
      setLocalStream(new MediaStream(stream.getTracks()))
    }

    // most phones can only open one camera at a time
    old.stop()
    stream.removeTrack(old)
    try {
      await open(next)
    } catch {
      try {
        await open(facing)
      } catch {
        /* ignore */
      }
      tell('Could not switch the camera.')
    }
  }

  // ---------- screen sharing ----------
  async function startShare() {
    if (!callRef.current || callRef.current.status === 'incoming' || screenRef.current) return
    if (!navigator.mediaDevices?.getDisplayMedia) {
      tell('Screen sharing is not supported on this device.')
      return
    }
    const other = Object.values(people).find((p) => p.screen)
    if (other) {
      tell(other.name + ' is already sharing their screen.')
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 24 } },
        audio: false,
      })
    } catch {
      return // you closed the picker
    }
    if (!callRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    const track = stream.getVideoTracks()[0]
    try {
      track.contentHint = 'detail'
    } catch {
      /* ignore */
    }
    screenRef.current = stream
    setLocalScreen(stream)
    // the browser's own "Stop sharing" button
    track.onended = () => stopShare()

    Object.keys(peers.current).forEach((id) => {
      const e = peers.current[id]
      signal(id, { type: 'screen', on: true, sid: stream.id })
      e.screenSender = e.pc.addTrack(track, stream)
      renegotiate(id)
    })
  }

  function stopShare() {
    const stream = screenRef.current
    if (!stream) return
    screenRef.current = null
    setLocalScreen(null)
    stream.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    Object.keys(peers.current).forEach((id) => {
      const e = peers.current[id]
      signal(id, { type: 'screen', on: false })
      if (e.screenSender) {
        try {
          e.pc.removeTrack(e.screenSender)
        } catch {
          /* ignore */
        }
        e.screenSender = null
      }
      renegotiate(id)
    })
  }

  async function onSignal(s) {
    const c = callRef.current

    if (s.type === 'invite') {
      if (blockRef.current) return
      if (c) {
        signal(s.from, { type: 'busy', room: s.room })
        return
      }
      invite.current = s
      names.current[s.from] = s.fromName
      ;(s.members || []).forEach((m) => (names.current[m.id] = m.name))
      updateCall({
        room: s.room,
        video: s.video,
        status: 'incoming',
        inviterId: s.from,
        inviterName: s.fromName,
        members: s.members || [],
      })
      ringTimer.current = setTimeout(() => {
        if (callRef.current?.status === 'incoming') cleanup()
      }, 60000)
      return
    }

    if (!c || c.room !== s.room) return

    // still ringing: only a cancel from the caller matters
    if (c.status === 'incoming') {
      if (s.type === 'leave' && s.from === c.inviterId) cleanup()
      return
    }

    if (s.fromName) {
      names.current[s.from] = s.fromName
      setPeople((ps) => (ps[s.from] ? { ...ps, [s.from]: { ...ps[s.from], name: s.fromName } } : ps))
    }

    if (s.type === 'hello') {
      connectTo(s.from, s.fromName)
    } else if (s.type === 'offer') {
      if (!local.current) return
      if (!peers.current[s.from] && Object.keys(peers.current).length + 1 >= MAX_PEOPLE) return
      try {
        const e = addPeer(s.from, s.fromName)
        // two offers at the same moment: one side gives way
        const collision = e.making || e.pc.signalingState !== 'stable'
        const polite = myId > s.from
        if (collision && !polite) return
        if (collision) e.dirty = true // we will offer again once this is settled
        await e.pc.setRemoteDescription(s.sdp)
        e.remote = true
        flushPending(e)
        const answer = await e.pc.createAnswer()
        await e.pc.setLocalDescription(answer)
        signal(s.from, { type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
        e.ready = true
        e.queue.splice(0).forEach((cand) => signal(s.from, { type: 'ice', candidate: cand }))
        // tell the newcomer who else is here (only once)
        if (!e.rosterSent) {
          e.rosterSent = true
          const others = Object.keys(peers.current)
            .filter((id) => id !== s.from)
            .map((id) => ({ id, name: names.current[id] || 'Participant' }))
          if (others.length) signal(s.from, { type: 'roster', members: others })
        }
      } catch (err) {
        console.log('[call] offer failed', err)
      }
    } else if (s.type === 'answer') {
      const e = peers.current[s.from]
      if (!e || e.pc.signalingState !== 'have-local-offer') return
      try {
        await e.pc.setRemoteDescription(s.sdp)
        e.remote = true
        flushPending(e)
      } catch (err) {
        console.log('[call] answer failed', err)
      }
    } else if (s.type === 'ice') {
      const e = peers.current[s.from]
      if (!e) {
        if (!earlyIce.current[s.from]) earlyIce.current[s.from] = []
        earlyIce.current[s.from].push(s.candidate)
      } else if (e.pc.remoteDescription) e.pc.addIceCandidate(s.candidate).catch(() => {})
      else e.pending.push(s.candidate)
    } else if (s.type === 'screen') {
      const e = peers.current[s.from]
      if (!e) {
        pendingScreen.current[s.from] = s.on ? s.sid : null
        return
      }
      if (s.on) e.screenId = s.sid
      else {
        if (e.screenId) delete e.streams[e.screenId]
        e.screenId = null
      }
      syncStreams(s.from)
    } else if (s.type === 'roster') {
      ;(s.members || []).forEach((m) => connectTo(m.id, m.name))
    } else if (s.type === 'state') {
      setPeople((ps) => (ps[s.from] ? { ...ps, [s.from]: { ...ps[s.from], mic: s.mic, cam: s.cam } } : ps))
    } else if (s.type === 'decline' || s.type === 'busy') {
      invited.current.delete(s.from)
      const name = names.current[s.from] || 'Someone'
      if (Object.keys(peers.current).length === 0 && invited.current.size === 0) {
        alert(s.type === 'busy' ? name + ' is busy in another call.' : name + ' declined the call.')
        cleanup()
      } else {
        tell(name + (s.type === 'busy' ? ' is busy' : ' declined'))
      }
    } else if (s.type === 'leave') {
      const name = names.current[s.from] || 'Someone'
      const had = !!peers.current[s.from]
      invited.current.delete(s.from)
      removePeer(s.from)
      if (!had) return
      if (Object.keys(peers.current).length === 0) {
        if (invited.current.size) {
          updateCall({ ...callRef.current, status: 'calling' })
          startRing()
          tell(name + ' left')
        } else {
          cleanup()
        }
      } else {
        tell(name + ' left')
      }
    }
  }

  useEffect(() => {
    const ch = supabase
      .channel('calls:' + myId)
      .on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload))
      .subscribe()

    const onLeave = () => {
      const c = callRef.current
      if (!c) return
      if (c.status === 'incoming') signal(c.inviterId, { type: 'decline', room: c.room })
      else {
        Object.keys(peers.current).forEach((id) => signal(id, { type: 'leave' }))
        invited.current.forEach((id) => signal(id, { type: 'leave' }))
      }
    }
    window.addEventListener('pagehide', onLeave)

    return () => {
      window.removeEventListener('pagehide', onLeave)
      supabase.removeChannel(ch)
      Object.values(sendChans.current).forEach((p) => p.then((c) => supabase.removeChannel(c)))
      sendChans.current = {}
      cleanup()
    }
  }, [myId])

  return {
    call, people, localStream, localScreen, media, facing, canFlip, notice,
    startCall, acceptCall, hangup, toggleMic, toggleCam, flipCamera, inviteMore,
    startShare, stopShare,
  }
}