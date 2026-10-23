import Avatar from './Avatar'
import Icon from './Icon'

export default function ProfileView({ profile, status, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h3>Contact info</h3>
          <button onClick={onClose} title="Close"><Icon name="close" size={22} /></button>
        </div>
        <div className="panel-body profile-view">
          <Avatar profile={profile} size={140} />
          <h2>{profile.display_name || profile.username}</h2>
          <p className="pf-user">@{profile.username}</p>
          {status && <p className="pf-status">{status}</p>}
          <div className="pf-about">
            <small>About</small>
            <p>{profile.about || 'Hey there! I am using this chat.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}