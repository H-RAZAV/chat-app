import { useEffect, useRef, useState } from 'react'

const TEXT = { calling: 'Calling...', connecting: 'Connecting...', connected: 'Connected' }

export default function CallScreen({ call, localStream, remoteStream, onAccept, onHangup }) {
  const remoteRef = useRef(null)
  const localRef = useRef(null)
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(true)
  const active = !!call

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream
  }, [remoteStream, active])

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream
  }, [localStream, active])

  useEffect(() => {
    if (!active) {
      setMic(true)
      setCam(true)
    }
  }, [active])

  if (!call) return null

  function toggleMic() {
    const t = localStream?.getAudioTracks()[0]
    if (t) { t.enabled = !t.enabled; setMic(t.enabled) }
  }
  function toggleCam() {
    const t = localStream?.getVideoTracks()[0]
    if (t) { t.enabled = !t.enabled; setCam(t.enabled) }
  }

  const showVideo = call.video && remoteStream

  return (
    <div className="call">
      <video ref={remoteRef} className={showVideo ? 'remote-video' : 'remote-audio'} autoPlay playsInline />
      {call.video && localStream && <video ref={localRef} className="local-video" autoPlay playsInline muted />}

      <div className={'call-info' + (showVideo ? ' top' : '')}>
        {!showVideo && <div className="big-avatar">{call.peerName?.[0]}</div>}
        <h2>{call.peerName}</h2>
        <p>
          {call.status === 'incoming'
            ? `Incoming ${call.video ? 'video' : 'voice'} call`
            : TEXT[call.status]}
        </p>
      </div>

      <div className="call-actions">
        {call.status === 'incoming' ? (
          <>
            <button className="call-btn red" onClick={onHangup}>✖</button>
            <button className="call-btn green" onClick={onAccept}>📞</button>
          </>
        ) : (
          <>
            <button className={'call-btn' + (mic ? '' : ' off')} onClick={toggleMic}>{mic ? '🎤' : '🔇'}</button>
            {call.video && (
              <button className={'call-btn' + (cam ? '' : ' off')} onClick={toggleCam}>{cam ? '📷' : '🚫'}</button>
            )}
            <button className="call-btn red" onClick={onHangup}>✖</button>
          </>
        )}
      </div>
    </div>
  )
}