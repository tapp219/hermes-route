import type { SessionCheck } from '../types/chat';

const VALID_ID = /^[A-Za-z0-9_-]{22}$/;

/**
 * Stand-in for the backend's "does this session exist?" call.
 * Demo rules: "expired" is expired, "full" is full, a malformed id is invalid, anything else is valid.
 */
export async function checkSession(sessionId: string): Promise<SessionCheck> {
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (sessionId === 'expired') return 'expired';
  if (sessionId === 'full') return 'full';
  return VALID_ID.test(sessionId) ? 'valid' : 'invalid';
}
