import type { SessionCheck } from '../../types/chat';
import type { Unsubscribe } from '../ChatTransport';
import { checkSession as mockCheck } from '../mockSession';
import type { SignalMessage, SignalingClient } from './signaling';

const CHANNEL = 'hermes-route-demo-signaling';
const VALID_ID = /^[A-Za-z0-9_-]{22}$/;

interface Wire {
  from: string;
  session: string;
  to?: string;
  type: 'hello' | 'hello-ack' | 'bye' | 'signal' | 'probe' | 'probe-reply';
  msg?: SignalMessage;
  count?: number;
}

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

/** Demo signaling between tabs of the same browser. Replace with a WebSocket client. */
export function createBroadcastSignaling(): SignalingClient {
  const clientId = crypto.randomUUID();
  const joinedCbs = new Set<() => void>();
  const leftCbs = new Set<() => void>();
  const signalCbs = new Set<(m: SignalMessage) => void>();
  let channel: BroadcastChannel | null = null;
  let session: string | null = null;
  let peer: string | null = null;

  const post = (w: Omit<Wire, 'from' | 'session'>) => {
    if (channel && session) channel.postMessage({ ...w, from: clientId, session });
  };
  const onHide = () => post({ type: 'bye' });

  const onMessage = (e: MessageEvent<Wire>) => {
    const w = e.data;
    if (w.from === clientId || w.session !== session) return;
    if (w.to && w.to !== clientId) return;
    switch (w.type) {
      case 'hello':
        if (peer && peer !== w.from) return; // room already has two people
        peer = w.from;
        post({ type: 'hello-ack', to: w.from });
        joinedCbs.forEach((cb) => cb());
        break;
      case 'hello-ack':
        peer = w.from;
        break;
      case 'signal':
        if (w.msg) signalCbs.forEach((cb) => cb(w.msg as SignalMessage));
        break;
      case 'bye':
        if (w.from === peer) {
          peer = null;
          leftCbs.forEach((cb) => cb());
        }
        break;
      case 'probe':
        post({ type: 'probe-reply', to: w.from, count: peer ? 2 : 1 });
        break;
    }
  };

  const leave = () => {
    if (channel) {
      post({ type: 'bye' });
      channel.close();
      window.removeEventListener('pagehide', onHide);
    }
    channel = null;
    session = null;
    peer = null;
  };

  return {
    join(sessionId) {
      leave();
      session = sessionId;
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = onMessage;
      window.addEventListener('pagehide', onHide);
      post({ type: 'hello' });
    },
    leave,
    send: (message) => post({ type: 'signal', msg: message, to: peer ?? undefined }),
    onPeerJoined: (cb) => subscribe(joinedCbs, cb),
    onPeerLeft: (cb) => subscribe(leftCbs, cb),
    onSignal: (cb) => subscribe(signalCbs, cb),
  };
}

/**
 * Demo stand-in for the server's session check: asks other tabs whether anyone hosts this id.
 * Nobody answering means the session is gone. "expired" and "full" still work as demo shortcuts.
 */
export function probeSession(sessionId: string): Promise<SessionCheck> {
  if (sessionId === 'expired' || sessionId === 'full') return mockCheck(sessionId);
  if (!VALID_ID.test(sessionId)) return Promise.resolve('invalid');
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const probe = new BroadcastChannel(CHANNEL);
    let count = 0;
    probe.onmessage = (e: MessageEvent<Wire>) => {
      const w = e.data;
      if (w.type === 'probe-reply' && w.to === id && w.session === sessionId) count = Math.max(count, w.count ?? 1);
    };
    probe.postMessage({ type: 'probe', from: id, session: sessionId });
    window.setTimeout(() => {
      probe.close();
      resolve(count === 0 ? 'expired' : count >= 2 ? 'full' : 'valid');
    }, 600);
  });
}
