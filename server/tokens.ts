import { createHash, randomBytes } from 'node:crypto';

/** Secret for the customer's order link. 192 bits of randomness. */
export function generateAccessToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Only this hash is stored in the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
