self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data.json() } catch { /* ignore */ }

  const title = data.title || 'Veil'
  const isCall = data.kind === 'call'
  const options = {
    body: data.body || '',
    icon: '/veil-icon.svg',
    badge: '/veil-icon.svg',
    tag: data.tag || 'veil-' + Date.now(),
    requireInteraction: isCall,
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [150, 80, 150],
    data: { url: data.url || '/' },
    actions: isCall
      ? [{ action: 'open', title: 'Answer' }, { action: 'dismiss', title: 'Decline' }]
      : [],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'open-chat', id: event.notification.data?.chatId })
          return c.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})