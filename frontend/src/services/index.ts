import { checkSession as mockCheckSession } from './mockSession';
import { createMockTransport } from './mockTransport';
import { createBroadcastSignaling, probeSession } from './webrtc/broadcastSignaling';
import { createWebRtcTransport } from './webrtc/WebRtcTransport';
import type { ChatTransport } from './ChatTransport';
import type { User } from '../types/chat';

/**
 * Default is WebRTC with demo signaling between tabs of the same browser.
 * Put VITE_TRANSPORT=mock in a .env file to use the simulated peer instead.
 */
const useMock = import.meta.env.VITE_TRANSPORT === 'mock';

export const PEER: User = { id: 'peer', name: useMock ? 'Alex' : 'Peer' };

export function createTransport(): ChatTransport {
  return useMock ? createMockTransport() : createWebRtcTransport(createBroadcastSignaling());
}

export const checkSession = useMock ? mockCheckSession : probeSession;
