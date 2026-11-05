import { env } from '../config/env';
import { hmacSha256, safeEqualHex } from './crypto';
import { DomainError } from './errors';

/** QR payload kinds: R = reservation pass, S = session ticket, P = parking pass. */
export type QrKind = 'R' | 'S' | 'P';
export interface QrClaims {
  k: QrKind;
  id: string;
  exp?: number; // unix seconds
}

const PREFIX = 'P2A1';

export function signQr(claims: QrClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = hmacSha256(env().QR_SIGNING_SECRET, `${PREFIX}.${body}`).slice(0, 32);
  return `${PREFIX}.${body}.${sig}`;
}

export function verifyQr(token: string): QrClaims {
  const [prefix, body, sig] = token.trim().split('.');
  if (prefix !== PREFIX || !body || !sig) throw new DomainError('QR_INVALID', 'Unrecognized QR code', 400);
  const expected = hmacSha256(env().QR_SIGNING_SECRET, `${PREFIX}.${body}`).slice(0, 32);
  if (!safeEqualHex(sig, expected)) throw new DomainError('QR_INVALID', 'QR signature invalid', 400);
  let claims: QrClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new DomainError('QR_INVALID', 'QR payload invalid', 400);
  }
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new DomainError('QR_EXPIRED', 'QR code expired', 400);
  return claims;
}
