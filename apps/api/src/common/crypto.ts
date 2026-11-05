import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const hmacSha256 = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Crockford-ish code without ambiguous chars. */
export function humanCode(len = 6): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function key(raw: string): Buffer {
  return createHash('sha256').update(raw).digest(); // derive 32 bytes from configured secret
}

export function encrypt(plain: string, rawKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(rawKey), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob: string, rawKey: string): string {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(rawKey), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
