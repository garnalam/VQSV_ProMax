import { randomBytes, createHash, pbkdf2, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);
const deriveLegacy = promisify(pbkdf2);
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummySalt = 'vqsv-invalid-user';
export const SESSION_MS = 7 * 86400_000;
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 32, options);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  const legacy = /^pbkdf2-sha256:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{43})$/.exec(stored ?? '');
  if (legacy) {
    const salt = Buffer.from(legacy[1], 'base64url');
    const expected = Buffer.from(legacy[2], 'base64url');
    const actual = await deriveLegacy(password, salt, 100000, 32, 'sha256');
    return timingSafeEqual(expected, actual);
  }
  const [, salt, hex] = (stored || `scrypt:${dummySalt}:${'0'.repeat(64)}`).split(':');
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, 32, options);
  return expected.length === actual.length && timingSafeEqual(expected, actual) && !!stored;
}

export function credentials(value) {
  const email = typeof value?.email === 'string' ? value.email.trim().toLowerCase() : '';
  const password = typeof value?.password === 'string' ? value.password : '';
  if (email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (password.length < 8 || password.length > 128) return null;
  return { email, password };
}

export function sessionToken(header = '') {
  const token = header.split(';').map(part => part.trim()).find(part => part.startsWith('vqsv_session='))?.slice(13);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
