/**
 * Whether a token was issued before the account's sessions were revoked.
 *
 * `iat` is in whole seconds, so a token minted in the same second as the
 * revocation is still accepted — erring on the side of not logging out the
 * session that was just created by signing in again.
 */
export function isTokenRevoked(user: { sessionsRevokedAt?: Date | null }, issuedAtSeconds?: number): boolean {
  if (!user.sessionsRevokedAt) return false;
  if (typeof issuedAtSeconds !== 'number') return true;
  return issuedAtSeconds < Math.floor(new Date(user.sessionsRevokedAt).getTime() / 1000);
}
