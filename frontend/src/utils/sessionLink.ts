/** The session id lives in the URL fragment (#s=...), which browsers never send to a server. */
export function buildInviteLink(sessionId: string): string {
  return `${window.location.origin}${window.location.pathname}#s=${sessionId}`;
}

/** Returns null when the page was not opened from an invite link. */
export function readSessionIdFromHash(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get('s');
}

/** Removes the fragment so the id is not left in the address bar or reused by a reload. */
export function clearSessionHash(): void {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
