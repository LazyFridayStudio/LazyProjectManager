/**
 * How long a session stays valid.
 *
 * Thirty days suits a self-hosted tool a studio keeps open all week; a shorter
 * window would mean signing in every morning for no security gain, because the
 * cookie never leaves the machine it was issued to.
 */
export const SESSION_LIFETIME_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function calculateSessionExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + SESSION_LIFETIME_DAYS * MILLISECONDS_PER_DAY);
}

export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function getSessionLifetimeSeconds(): number {
  return SESSION_LIFETIME_DAYS * 24 * 60 * 60;
}
