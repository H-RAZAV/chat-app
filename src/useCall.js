import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

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
  // test mode: open the site with ?relay=1 to force every call through the relay
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
  return 'Call failed even with the relay server. Check that your Metered account is active and still has free data left.'
}

export function useCall(myId, myName) {
  const [call, setCall] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)

  const callRef = useRef(null)
  const pc = useRef(null)
  const local = useRef(null)
  const pendingOffer = useRef(null)
  const pendingIce = useRef([])
  const earlyIce = useRef({})
  const flushLocal = useRef(() => {})
  const iceInfo = useRef(null)
  const sendChans = useRef({})
  const ringTimer = useRef(null)
  const connectTimer = useRef(null)

  function updateCall(c) {
    callRef.current = c
    setCall(c)
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
    getSendChannel(toId).then((ch) =>
      ch.send({ type: 'broadcast', event: 'signal', payload: { ...payload, from: myId } })
    )
  }

  function cleanup() {
    clearTimeout(ringTimer.current)
    clearTimeout(connectTimer.current)
    if (pc.current) {
      pc.current.onconnectionstatechange = null
      pc.current.oniceconnectionstatechange = null
      pc.current.close()
      pc.current = null
    }
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
    pendingOffer.current = null
    pendingIce.current = []
    earlyIce.current = {}
    flushLocal.current = () => {}
    setLocalStream(null)
    setRemoteStream(null)
    updateCall(null)
  }

  function hangup() {
    const c = callRef.current
    if (c) signal(c.peerId, { type: c.status === 'incoming' ? 'reject' : 'hangup' })
    cleanup()
  }

  function fail() {
    if (!callRef.current) return
    alert(failText(iceInfo.current))
    hangup()
  }

  // give up if the call has not connected 25 seconds after the answer
  function armConnectTimer() {
    clearTimeout(connectTimer.current)
    connectTimer.current = setTimeout(() => {
      if (callRef.current && callRef.current.status !== 'connected') fail()
    }, 25000)
  }

  function flushIce() {
    pendingIce.current.forEach((c) => pc.current?.addIceCandidate(c).catch(() => {}))
    pendingIce.current = []
  }

  function createPeer(peerId, ice) {
    const p = new RTCPeerConnection(ice.config)

    // our own network details wait until the offer/answer has been sent first
    let ready = false
    const queue = []
    p.onicecandidate = (e) => {
      if (!e.candidate) return
      const c = e.candidate.toJSON()
      if (ready) signal(peerId, { type: 'ice', candidate: c })
      else queue.push(c)
    }
    flushLocal.current = () => {
      ready = true
      queue.splice(0).forEach((c) => signal(peerId, { type: 'ice', candidate: c }))
    }

    p.ontrack = (e) => setRemoteStream(e.streams[0])
    p.oniceconnectionstatechange = () => console.log('[call] ice:', p.iceConnectionState)
    p.onconnectionstatechange = () => {
      console.log('[call] connection:', p.connectionState)
      if (p.connectionState === 'connected') {
        clearTimeout(ringTimer.current)
        clearTimeout(connectTimer.current)
        if (callRef.current) updateCall({ ...callRef.current, status: 'connected' })
      } else if (p.connectionState === 'failed') {
        fail()
      }
    }
    local.current.getTracks().forEach((t) => p.addTrack(t, local.current))
    pc.current = p
    return p
  }

  async function getMedia(video) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      alert('Please allow microphone' + (video ? ' and camera' : '') + ' access to use calls.')
      return null
    }
  }

  async function startCall(peer, video) {
    if (callRef.current) return
    updateCall({ peerId: peer.id, peerName: peer.username, video, status: 'calling' })
    const stream = await getMedia(video)
    if (!stream) return cleanup()
    if (!callRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    local.current = stream
    setLocalStream(stream)
    const ice = await getIce()
    iceInfo.current = ice
    if (!callRef.current) return
    const p = createPeer(peer.id, ice)
    const offer = await p.createOffer()
    await p.setLocalDescription(offer)
    signal(peer.id, {
      type: 'offer',
      fromName: myName,
      video,
      sdp: { type: offer.type, sdp: offer.sdp },
    })
    flushLocal.current()
    ringTimer.current = setTimeout(() => {
      if (callRef.current?.status === 'calling') {
        alert('No answer.')
        hangup()
      }
    }, 45000)
  }

  async function acceptCall() {
    const offer = pendingOffer.current
    const c = callRef.current
    if (!offer || !c) return
    clearTimeout(ringTimer.current)
    updateCall({ ...c, status: 'connecting' })
    const stream = await getMedia(offer.video)
    if (!stream) {
      signal(offer.from, { type: 'reject' })
      return cleanup()
    }
    if (!callRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    local.current = stream
    setLocalStream(stream)
    const ice = await getIce()
    iceInfo.current = ice
    if (!callRef.current) return
    const p = createPeer(offer.from, ice)
    await p.setRemoteDescription(offer.sdp)
    flushIce()
    const answer = await p.createAnswer()
    await p.setLocalDescription(answer)
    signal(offer.from, { type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
    flushLocal.current()
    armConnectTimer()
  }

  async function onSignal(s) {
    const c = callRef.current
    if (s.type === 'offer') {
      if (c) return signal(s.from, { type: 'busy' })
      pendingOffer.current = s
      pendingIce.current = earlyIce.current[s.from] || []
      delete earlyIce.current[s.from]
      updateCall({ peerId: s.from, peerName: s.fromName, video: s.video, status: 'incoming' })
      ringTimer.current = setTimeout(() => {
        if (callRef.current?.status === 'incoming') cleanup()
      }, 60000)
    } else if (s.type === 'ice') {
      if (!c) {
        // arrived before the offer: keep it for later
        if (!earlyIce.current[s.from]) earlyIce.current[s.from] = []
        earlyIce.current[s.from].push(s.candidate)
        return
      }
      if (c.peerId !== s.from) return
      if (pc.current?.remoteDescription) pc.current.addIceCandidate(s.candidate).catch(() => {})
      else pendingIce.current.push(s.candidate)
    } else if (s.type === 'answer') {
      if (!c || c.peerId !== s.from || !pc.current) return
      clearTimeout(ringTimer.current)
      updateCall({ ...c, status: 'connecting' })
      await pc.current.setRemoteDescription(s.sdp)
      flushIce()
      armConnectTimer()
    } else if (s.type === 'hangup' || s.type === 'reject' || s.type === 'busy') {
      if (c && c.peerId === s.from) {
        cleanup()
        if (s.type === 'busy') alert('The user is busy in another call.')
        if (s.type === 'reject') alert('Call declined.')
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
      if (c) signal(c.peerId, { type: c.status === 'incoming' ? 'reject' : 'hangup' })
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

  return { call, localStream, remoteStream, startCall, acceptCall, hangup }
}