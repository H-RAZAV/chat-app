import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
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
  const sendChans = useRef({})
  const ringTimer = useRef(null)

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
    if (pc.current) {
      pc.current.onconnectionstatechange = null
      pc.current.close()
      pc.current = null
    }
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
    pendingOffer.current = null
    pendingIce.current = []
    setLocalStream(null)
    setRemoteStream(null)
    updateCall(null)
  }

  function hangup() {
    const c = callRef.current
    if (c) signal(c.peerId, { type: c.status === 'incoming' ? 'reject' : 'hangup' })
    cleanup()
  }

  function flushIce() {
    pendingIce.current.forEach((c) => pc.current?.addIceCandidate(c).catch(() => {}))
    pendingIce.current = []
  }

  function createPeer(peerId) {
    const p = new RTCPeerConnection(ICE)
    p.onicecandidate = (e) => {
      if (e.candidate) signal(peerId, { type: 'ice', candidate: e.candidate.toJSON() })
    }
    p.ontrack = (e) => setRemoteStream(e.streams[0])
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected') {
        clearTimeout(ringTimer.current)
        if (callRef.current) updateCall({ ...callRef.current, status: 'connected' })
      } else if (p.connectionState === 'failed') {
        alert('The call could not connect. Your networks may be blocking direct calls.')
        hangup()
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
    const p = createPeer(peer.id)
    const offer = await p.createOffer()
    await p.setLocalDescription(offer)
    signal(peer.id, {
      type: 'offer',
      fromName: myName,
      video,
      sdp: { type: offer.type, sdp: offer.sdp },
    })
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
    const p = createPeer(offer.from)
    await p.setRemoteDescription(offer.sdp)
    flushIce()
    const answer = await p.createAnswer()
    await p.setLocalDescription(answer)
    signal(offer.from, { type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
  }

  async function onSignal(s) {
    const c = callRef.current
    if (s.type === 'offer') {
      if (c) return signal(s.from, { type: 'busy' })
      pendingOffer.current = s
      pendingIce.current = []
      updateCall({ peerId: s.from, peerName: s.fromName, video: s.video, status: 'incoming' })
      ringTimer.current = setTimeout(() => {
        if (callRef.current?.status === 'incoming') cleanup()
      }, 60000)
    } else if (s.type === 'ice') {
      if (!c || c.peerId !== s.from) return
      if (pc.current?.remoteDescription) pc.current.addIceCandidate(s.candidate).catch(() => {})
      else pendingIce.current.push(s.candidate)
    } else if (s.type === 'answer') {
      if (!c || c.peerId !== s.from || !pc.current) return
      clearTimeout(ringTimer.current)
      updateCall({ ...c, status: 'connecting' })
      await pc.current.setRemoteDescription(s.sdp)
      flushIce()
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