import 'server-only';

import crypto from 'node:crypto';
import { optionalEnv } from '@/lib/env';

/**
 * Workspace SMTP passwords are encrypted before they touch Postgres, and the
 * table that holds them has no read policy for any client role. The key lives in
 * APP_ENCRYPTION_KEY — a 32-byte hex value, separate from the database
 * credential, so a leaked dump is not also a set of usable mail credentials.
 */

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function key(): Buffer {
  const raw = optionalEnv('APP_ENCRYPTION_KEY');
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'APP_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  const buffer = Buffer.from(raw, 'hex');
  if (buffer.length !== KEY_LENGTH) {
    throw new Error('APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return buffer;
}

/** `iv.tag.ciphertext`, all base64 — enough framing to decrypt without guessing. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Stored secret is malformed');

  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) throw new Error('Stored secret is malformed');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Used for the visitor hash on form submissions: never store a raw IP. */
export function hashForBucketing(value: string): string {
  const salt = optionalEnv('APP_ENCRYPTION_KEY') ?? 'youbiss-unsalted';
  return crypto.createHmac('sha256', String(salt)).update(value).digest('hex').slice(0, 32);
}

export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function timingSafeEqualToString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
