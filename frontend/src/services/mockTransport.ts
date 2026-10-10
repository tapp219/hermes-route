import type { ChatTransport, Unsubscribe } from './ChatTransport';
import type { ConnectionStatus, Message } from '../types/chat';

const GREETING =
  'Hey! Say something and I will reply. Demo shortcuts: send /leave to see me disconnect for a few seconds, or /end to see me end the session.';
const REPLIES = [
  'Nice, that makes sense.',
  'Tell me more about that.',
  'Ha, I did not expect that.',
  'Agreed. Want to pick this up later today?',
  'Got it. I will take a look and get back to you.',
];
const AWAY_MS = 6000;

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

/** Simulated peer: connects after a short delay, shows typing, then replies. */
export function createMockTransport(): ChatTransport {
  const messageCbs = new Set<(m: Message) => void>();
  const typingCbs = new Set<(t: boolean) => void>();
  const statusCbs = new Set<(s: ConnectionStatus) => void>();
  const presenceCbs = new Set<(online: boolean) => void>();
  const endedCbs = new Set<() => void>();
  let timers: number[] = [];
  let replyIndex = 0;

  const later = (fn: () => void, ms: number) => {
    timers.push(window.setTimeout(fn, ms));
  };
  const setStatus = (s: ConnectionStatus) => statusCbs.forEach((cb) => cb(s));
  const setTyping = (t: boolean) => typingCbs.forEach((cb) => cb(t));
  const setPresence = (online: boolean) => presenceCbs.forEach((cb) => cb(online));
  const peerSays = (text: string) =>
    messageCbs.forEach((cb) =>
      cb({ id: crypto.randomUUID(), author: 'peer', text, timestamp: Date.now() }),
    );

  return {
    connect() {
      setStatus('connecting');
      setPresence(true);
      later(() => setStatus('connected'), 700);
      later(() => peerSays(GREETING), 1500);
    },
    disconnect() {
      timers.forEach(clearTimeout);
      timers = [];
      replyIndex = 0;
      setTyping(false);
      setStatus('disconnected');
    },
    send(text) {
      const command = text.trim();
      if (command === '/leave') {
        later(() => {
          setTyping(false);
          setPresence(false);
        }, 600);
        later(() => setPresence(true), 600 + AWAY_MS);
        return;
      }
      if (command === '/end') {
        later(() => endedCbs.forEach((cb) => cb()), 600);
        return;
      }
      const thinking = 400;
      const typing = 900 + Math.random() * 900;
      later(() => setTyping(true), thinking);
      later(() => {
        setTyping(false);
        peerSays(REPLIES[replyIndex++ % REPLIES.length]);
      }, thinking + typing);
    },
    endSession() {
      this.disconnect();
    },
    sendTyping() {},
    onMessage: (cb) => subscribe(messageCbs, cb),
    onTyping: (cb) => subscribe(typingCbs, cb),
    onStatus: (cb) => subscribe(statusCbs, cb),
    onPeerPresence: (cb) => subscribe(presenceCbs, cb),
    onSessionEnded: (cb) => subscribe(endedCbs, cb),
  };
}
