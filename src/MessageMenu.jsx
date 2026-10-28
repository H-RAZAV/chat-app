import Icon from './Icon'

export default function MessageMenu({ m, mine, onReply, onCopy, onDeleteMe, onDeleteAll, onClose }) {
  const gone = !!m.deleted_at
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {!gone && !m.locked && (
          <button onClick={onReply}><Icon name="reply" size={20} /> Reply</button>
        )}
        {!gone && m.content && (
          <button onClick={onCopy}><Icon name="copy" size={20} /> Copy</button>
        )}
        <button onClick={onDeleteMe}><Icon name="trash" size={20} /> Delete for me</button>
        {mine && !gone && (
          <button className="danger" onClick={onDeleteAll}><Icon name="ban" size={20} /> Delete for everyone</button>
        )}
        <button className="cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}