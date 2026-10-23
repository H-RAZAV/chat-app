export default function Avatar({ profile, online, size = 40 }) {
  const letter = (profile?.display_name || profile?.username || '?')[0]
  return (
    <div
      className={'avatar' + (online ? ' on' : '')}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : letter}
    </div>
  )
}