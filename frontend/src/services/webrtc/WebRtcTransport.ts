import type { ChatTransport, Unsubscribe } from '../ChatTransport';
import type { ConnectionStatus, Message } from '../../types/chat';
import { RTC_CONFIG } from './rtcConfig';
import type { SignalMessage, SignalingClient } from './signaling';

const MAX_TEXT = 4000;
const MAX_RAW = 8000;
const PING_MS = 3000;
const PEER_TIMEOUT_MS = 9000;
const TYPING_EXPIRY_MS = 5000;
const LEAVE_GRACE_MS = 800; // lets an "end" message beat the signaling "bye"

/** Connection diagnostics for development only. Never logs message contents. */
const log = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.debug('[hermes]', ...args);
};

/** Everything sent over the data channel, wrapped as { v: 1, ...message }. */
type Wire = { t: 'msg'; text: string } | { t: 'typing'; on: boolean } | { t: 'ping' } | { t: 'end' };

function parseWire(raw: unknown): Wire | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!d || d.v !== 1) return null;
    if (d.t === 'msg' && typeof d.text === 'string' && d.text.trim() && d.text.length <= MAX_TEXT) return { t: 'msg', text: d.text };
    if (d.t === 'typing' && typeof d.on === 'boolean') return { t: 'typing', on: d.on };
    if (d.t === 'ping') return { t: 'ping' };
    if (d.t === 'end') return { t: 'end' };
  } catch {
    /* malformed input is ignored */
  }
  return null;
}

function subscribe<T>(set: Set<T>, cb: T): Unsubscribe {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

/** Browser-to-browser chat over a WebRTC data channel (always DTLS-encrypted). */
export function createWebRtcTransport(signaling: SignalingClient, config: RTCConfiguration = RTC_CONFIG): ChatTransport {
  const messageCbs = new Set<(m: Message) => void>();
  const typingCbs = new Set<(t: boolean) => void>();
  const statusCbs = new Set<(s: ConnectionStatus) => void>();
  const presenceCbs = new Set<(online: boolean) => void>();
  const endedCbs = new Set<() => void>();

  let pc: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let offs: Unsubscribe[] = [];
  let pending: { id: string; candidate: RTCIceCandidateInit }[] = [];
  let negotiationId = '';
  let heartbeat = 0;
  let typingExpiry = 0;
  let lastSeen = 0;
  let peerOnline = false;

  const emitStatus = (s: ConnectionStatus) => statusCbs.forEach((cb) => cb(s));
  const emitTyping = (t: boolean) => typingCbs.forEach((cb) => cb(t));
  const setPeerOnline = (online: boolean) => {
    if (peerOnline === online) return;
    peerOnline = online;
    presenceCbs.forEach((cb) => cb(online));
  };
  const seen = () => {
    lastSeen = Date.now();
    setPeerOnline(true);
  };
  const markGone = () => {
    setPeerOnline(false);
    window.clearTimeout(typingExpiry);
    emitTyping(false);
  };

  const sendWire = (w: Wire) => {
    if (channel?.readyState === 'open') channel.send(JSON.stringify({ v: 1, ...w }));
  };

  const handleWire = (w: Wire) => {
    seen();
    if (w.t === 'msg') {
      window.clearTimeout(typingExpiry);
      emitTyping(false);
      messageCbs.forEach((cb) => cb({ id: crypto.randomUUID(), author: 'peer', text: w.text, timestamp: Date.now() }));
    } else if (w.t === 'typing') {
      window.clearTimeout(typingExpiry);
      emitTyping(w.on);
      if (w.on) typingExpiry = window.setTimeout(() => emitTyping(false), TYPING_EXPIRY_MS);
    } else if (w.t === 'end') {
      endedCbs.forEach((cb) => cb());
    }
  };

  const teardownPeer = () => {
    window.clearInterval(heartbeat);
    window.clearTimeout(typingExpiry);
    const ch = channel;
    const p = pc;
    channel = null;
    pc = null;
    ch?.close();
    p?.close();
  };

  const wireChannel = (ch: RTCDataChannel) => {
    channel = ch;
    const handleOpen = () => {
      if (channel !== ch) return;
      log('data channel open');
      emitStatus('connected');
      seen();
      window.clearInterval(heartbeat);
      heartbeat = window.setInterval(() => {
        sendWire({ t: 'ping' });
        if (peerOnline && Date.now() - lastSeen > PEER_TIMEOUT_MS) markGone();
      }, PING_MS);
    };
    ch.onopen = handleOpen;
    if (ch.readyState === 'open') handleOpen();
    ch.onclose = () => {
      if (channel === ch) markGone();
    };
    ch.onmessage = (e) => {
      if (channel !== ch) return;
      const w = parseWire(e.data);
      if (w) handleWire(w);
    };
  };

  const createPeer = (): RTCPeerConnection => {
    teardownPeer();
    const p = new RTCPeerConnection(config);
    const id = negotiationId;
    pc = p;
    p.onicecandidate = (e) => {
      if (e.candidate) log('local candidate', e.candidate.type, (e.candidate.address ?? '').endsWith('.local') ? '(hidden .local name)' : '(real address)');
      if (e.candidate && pc === p) signaling.send({ kind: 'candidate', id, candidate: e.candidate.toJSON() });
    };
    p.oniceconnectionstatechange = () => log('ice', p.iceConnectionState);
    p.onconnectionstatechange = () => {
      log('connection', p.connectionState);
      if (pc === p && (p.connectionState === 'failed' || p.connectionState === 'closed')) markGone();
    };
    p.ondatachannel = (e) => wireChannel(e.channel);
    return p;
  };

  const flushCandidates = () => {
    const queued = pending;
    pending = [];
    for (const { id, candidate } of queued) {
      if (id === negotiationId) void pc?.addIceCandidate(candidate).catch(() => undefined);
    }
  };

  const startOffer = async () => {
    const id = crypto.randomUUID();
    negotiationId = id;
    log('sending offer');
    const p = createPeer();
    wireChannel(p.createDataChannel('chat'));
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    signaling.send({ kind: 'offer', id, sdp: offer.sdp ?? '' });
  };

  const handleSignal = async (m: SignalMessage) => {
    if (m.kind === 'offer') {
      log('received offer');
      negotiationId = m.id;
      const p = createPeer();
      await p.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      signaling.send({ kind: 'answer', id: m.id, sdp: answer.sdp ?? '' });
      flushCandidates();
    } else if (m.kind === 'answer') {
      if (m.id !== negotiationId || !pc) {
        log('ignored stale answer');
        return;
      }
      log('received answer');
      await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      flushCandidates();
    } else if (m.id === negotiationId && pc?.remoteDescription) {
      void pc.addIceCandidate(m.candidate).catch(() => undefined); // not awaited: it can stall on unresolved .local names
    } else if (pending.length < 100) {
      pending.push({ id: m.id, candidate: m.candidate }); // may belong to an offer that has not arrived yet
    }
  };

  /** Runs signaling work one step at a time, and drops work from an earlier connection. */
  const enqueue = (task: () => Promise<void>) => {
    const g = generation;
    queue = queue
      .then(() => (g === generation ? task() : undefined))
      .catch((err) => console.warn('Signaling step failed', err));
  };

  const disconnect = () => {
    generation++;
    offs.forEach((off) => off());
    offs = [];
    signaling.leave();
    teardownPeer();
    pending = [];
    negotiationId = '';
    peerOnline = false;
    emitTyping(false);
    emitStatus('disconnected');
  };

  return {
    connect(sessionId) {
      generation++;
      offs.forEach((off) => off());
      offs = [];
      teardownPeer();
      pending = [];
      negotiationId = '';
      emitStatus('connecting');
      offs = [
        signaling.onPeerJoined(() => enqueue(startOffer)),
        signaling.onPeerLeft(() => {
          const g = generation;
          const p = pc;
          window.setTimeout(() => {
            if (g !== generation || pc !== p) return; // ended, or a new connection took over
            teardownPeer();
            pending = [];
            markGone();
          }, LEAVE_GRACE_MS);
        }),
        signaling.onSignal((m) => enqueue(() => handleSignal(m))),
      ];
      signaling.join(sessionId);
    },
    disconnect,
    endSession() {
      sendWire({ t: 'end' });
      disconnect();
    },
    send: (text) => sendWire({ t: 'msg', text: text.slice(0, MAX_TEXT) }),
    sendTyping: (on) => sendWire({ t: 'typing', on }),
    onMessage: (cb) => subscribe(messageCbs, cb),
    onTyping: (cb) => subscribe(typingCbs, cb),
    onStatus: (cb) => subscribe(statusCbs, cb),
    onPeerPresence: (cb) => subscribe(presenceCbs, cb),
    onSessionEnded: (cb) => subscribe(endedCbs, cb),
  };
}
