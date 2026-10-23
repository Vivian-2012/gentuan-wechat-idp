/** HMAC-SHA256 helpers (Web Crypto) */

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomState(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signState(secret, payload) {
  const body = btoa(JSON.stringify(payload));
  const sig = await hmacHex(secret, body);
  return `${body}.${sig}`;
}

export async function verifyState(secret, token, maxAgeSec = 600) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = await hmacHex(secret, body);
  if (expect !== sig) return null;
  let payload;
  try {
    payload = JSON.parse(atob(body));
  } catch {
    return null;
  }
  if (!payload || !payload.ts || Date.now() / 1000 - payload.ts > maxAgeSec) return null;
  return payload;
}
