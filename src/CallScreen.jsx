import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import Avatar from './Avatar'

function Tile({ stream, name, camOn, micOn, muted, mirror }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null
  }, [stream])
  const showVideo = !!stream && camOn && stream.getVideoTracks().length > 0

  return (
    <div className="tile">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={'tile-video' + (showVideo ? '' : ' off') + (mirror ? ' mirror' : '')}
      />
      {!showVideo && (
        <div className="tile-avatar">
          <div className="big-avatar">{(name || '?')[0]}</div>
        </div>
      )}
      <div className="tile-name">
        {!micOn && <Icon name="micOff" size={14} />}
        {name}
      </div>
    </div>
  )
}

export default function CallScreen({
  call, people, localStream, media, facing, canFlip, notice, contacts,
  onAccept, onHangup, onToggleMic, onToggleCam, onFlip, onInvite,
}) {
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (!call) setAdding(false)
  }, [call])

  if (!call) return null

  // ---------- someone is calling you ----------
  if (call.status === 'incoming') {
    const inCall = (call.members || []).length
    return (
      <div className="call">
        <div className="call-info">
          <div className="big-avatar ring">{call.inviterName?.[0]}</div>
          <h2>{call.inviterName}</h2>
          <p>
            Incoming {call.video ? 'video' : 'voice'} call
            {inCall > 1 ? ` · ${inCall} people are already in it` : ''}
          </p>
        </div>
        <div className="call-actions">
          <button className="call-btn red" title="Decline" onClick={onHangup}>
            <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
          </button>
          <button className="call-btn green" title="Accept" onClick={onAccept}>
            <Icon name={call.video ? 'video' : 'phone'} size={26} />
          </button>
        </div>
      </div>
    )
  }

  // ---------- in a call ----------
  const remote = Object.values(people)
  const total = remote.length + 1
  const pip = call.video && remote.length === 1
  const selfTile = (
    <Tile stream={localStream} name="You" camOn={media.cam} micOn={media.mic} muted mirror={facing === 'user'} />
  )
  const showSelfTile = !pip && (call.video || remote.length > 1)
  const count = remote.length + (showSelfTile ? 1 : 0)
  const status =
    remote.length === 0
      ? 'Calling...'
      : remote.some((p) => p.state !== 'connected')
      ? 'Connecting...'
      : total > 2
      ? total + ' people'
      : 'Connected'
  const available = (contacts || []).filter((c) => !people[c.id])

  return (
    <div className="call">
      {remote.length === 0 ? (
        <>
          {call.video && <div className="tiles n1">{selfTile}</div>}
          <div className={'call-info' + (call.video ? ' over' : '')}>
            {!call.video && <div className="big-avatar ring">{(call.title || '?')[0]}</div>}
            <h2>{call.title}</h2>
            <p>Calling...</p>
          </div>
        </>
      ) : (
        <div className={'tiles n' + Math.min(count, 5)}>
          {remote.map((p) => (
            <Tile key={p.id} stream={p.stream} name={p.name} camOn={p.cam} micOn={p.mic} />
          ))}
          {showSelfTile && selfTile}
        </div>
      )}

      {pip && localStream && <div className="pip">{selfTile}</div>}

      <div className="call-top">{status}</div>
      {notice && <div className="call-notice">{notice}</div>}

      {adding && (
        <div className="add-panel">
          {available.length ? (
            available.map((c) => (
              <div className="add-row" key={c.id}>
                <Avatar profile={c.profile} size={36} />
                <span>{c.username}</span>
                <button onClick={() => { onInvite(c); setAdding(false) }}>Add</button>
              </div>
            ))
          ) : (
            <p className="add-empty">
              Nobody else is online right now. People you have chatted with show up here when they open Veil.
            </p>
          )}
        </div>
      )}

      <div className="call-actions">
        <button className={'call-btn' + (media.mic ? '' : ' off')} title="Mute" onClick={onToggleMic}>
          <Icon name={media.mic ? 'mic' : 'micOff'} size={26} />
        </button>
        {call.video && (
          <button className={'call-btn' + (media.cam ? '' : ' off')} title="Camera" onClick={onToggleCam}>
            <Icon name={media.cam ? 'video' : 'videoOff'} size={26} />
          </button>
        )}
        {call.video && canFlip && (
          <button className="call-btn" title="Switch camera" onClick={onFlip}>
            <Icon name="flip" size={26} />
          </button>
        )}
        <button className="call-btn" title="Add people" disabled={total >= 5} onClick={() => setAdding((a) => !a)}>
          <Icon name="userPlus" size={26} />
        </button>
        <button className="call-btn red" title="End call" onClick={onHangup}>
          <Icon name="phone" size={26} style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>
    </div>
  )
}