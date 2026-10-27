const enc = new TextEncoder()
const dec = new TextDecoder()
const ITERATIONS = 600000
const CURVE = { name: 'ECDH', namedCurve: 'P-256' }

// ---------- small helpers ----------
export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

export function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export const cryptoReady = !!(window.crypto && window.crypto.subtle)

// ---------- your identity (key pair) ----------
export async function createIdentity() {
  const pair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])
  const pub = b64(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return { pub, pkcs8 }
}

export function importPrivate(pkcs8) {
  // not extractable: the key can be used, but never read back out
  return crypto.subtle.importKey('pkcs8', pkcs8, CURVE, false, ['deriveBits'])
}

// ---------- locking your private key with your passphrase ----------
async function passphraseKey(pass, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function wrapPrivate(pkcs8, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await passphraseKey(pass, salt, ITERATIONS)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pkcs8))
  return { salt: b64(salt), iterations: ITERATIONS, blob: b64(concat(iv, ct)) }
}

// throws if the passphrase is wrong
export async function unwrapPrivate(backup, pass) {
  const key = await passphraseKey(pass, unb64(backup.salt), backup.iterations)
  const all = unb64(backup.blob)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12))
}

// ---------- remembering the key on this device ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('veil-keys', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('keys')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export async function saveKey(userId, key, pub) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    tx.objectStore('keys').put({ key, pub }, userId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadKey(userId) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('keys', 'readonly').objectStore('keys').get(userId)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function clearKey(userId) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    tx.objectStore('keys').delete(userId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------- the key shared by you and one other person ----------
export async function derivePairKey(myPrivate, myPub, theirPub) {
  const theirKey = await crypto.subtle.importKey('spki', unb64(theirPub), CURVE, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, myPrivate, 256)
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const [a, b] = [myPub, theirPub].sort()
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('veil-v1|' + a + '|' + b) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ---------- messages ----------
export async function sealJson(key, aad, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
      key,
      enc.encode(JSON.stringify(obj))
    )
  )
  return 'v1.' + b64(iv) + '.' + b64(ct)
}

export async function openJson(key, aad, str) {
  const [version, iv, ct] = str.split('.')
  if (version !== 'v1') throw new Error('unknown format')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(aad) },
    key,
    unb64(ct)
  )
  return JSON.parse(dec.decode(plain))
}

// ---------- files ----------
export async function sealBytes(buf) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf))
  return { blob: new Blob([iv, ct], { type: 'application/octet-stream' }), key: b64(raw) }
}

export async function openBytes(buf, keyB64) {
  const all = new Uint8Array(buf)
  const key = await crypto.subtle.importKey('raw', unb64(keyB64), 'AES-GCM', false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12))
}

// ---------- security code (compare it with your friend) ----------
export async function safetyNumber(pubA, pubB) {
  const [x, y] = [pubA, pubB].sort()
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(x + '|' + y)))
  let n = BigInt(0)
  hash.forEach((h) => {
    n = (n << BigInt(8)) | BigInt(h)
  })
  return n.toString().padStart(78, '0').slice(0, 60).match(/.{5}/g)
}