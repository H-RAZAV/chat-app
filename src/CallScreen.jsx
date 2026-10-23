import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

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
            <button className="call-btn red" title="Decline" onClick={onHangup}>
              <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
            </button>
            <button className="call-btn green" title="Accept" onClick={onAccept}>
              <Icon name={call.video ? 'video' : 'phone'} size={26} />
            </button>
          </>
        ) : (
          <>
            <button className={'call-btn' + (mic ? '' : ' off')} title="Mute" onClick={toggleMic}>
              <Icon name={mic ? 'mic' : 'micOff'} size={26} />
            </button>
            {call.video && (
              <button className={'call-btn' + (cam ? '' : ' off')} title="Camera" onClick={toggleCam}>
                <Icon name={cam ? 'video' : 'videoOff'} size={26} />
              </button>
            )}
            <button className="call-btn red" title="End call" onClick={onHangup}>
              <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}