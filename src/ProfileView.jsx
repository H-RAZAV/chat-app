import { useEffect, useState } from 'react'
import Avatar from './Avatar'
import Icon from './Icon'
import { Name, Tags } from './Verified'
import { safetyNumber } from './crypto'

export default function ProfileView({ profile, status, myKey, onClose }) {
  const [code, setCode] = useState(null)
  const name = profile.display_name || profile.username

  useEffect(() => {
    if (!myKey || !profile.public_key) {
      setCode(null)
      return
    }
    safetyNumber(myKey, profile.public_key).then(setCode)
  }, [myKey, profile.public_key])

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Contact info</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="panel-body profile-view">
          <Avatar profile={profile} size={140} />
          <h2><Name p={profile} size={22} /></h2>
          <p className="pf-user">@{profile.username}</p>
          <Tags profile={profile} />
          {status && <p className="pf-status">{status}</p>}
          <div className="pf-about">
            <small>About</small>
            <p>{profile.about || 'Hey there! I am using Veil.'}</p>
          </div>
          <div className="pf-about sec">
            <small><Icon name="lock" size={13} /> End-to-end encryption</small>
            {code ? (
              <>
                <div className="sec-code">
                  {code.map((g, i) => <span key={i}>{g}</span>)}
                </div>
                <p className="sec-hint">
                  To check that this chat is private, compare these numbers with {name}, in person or on a call.
                  If they match on both phones, nobody is in the middle.
                </p>
              </>
            ) : (
              <p className="sec-hint">{name} has not set up encryption yet, so you cannot message each other until they do.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}