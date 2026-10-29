import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')!
const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!
const vapidSubject = Deno.env.get('VAPID_SUBJECT')!

webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

Deno.serve(async (req) => {
  try {
    const { user_id, title, body, kind, chat_id } = await req.json()
    const admin = createClient(supabaseUrl, serviceKey)
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', user_id)

    if (!subs || !subs.length) return new Response('no subs', { status: 200 })

    const payload = JSON.stringify({ title, body, kind, tag: 'veil-' + (chat_id || 'x'), url: '/', chatId: chat_id })

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            payload
          )
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('id', s.id)
          }
        }
      })
    )
    return new Response('ok', { status: 200 })
  } catch (err) {
    return new Response(String(err), { status: 500 })
  }
})