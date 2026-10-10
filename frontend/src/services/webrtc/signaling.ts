import type { Unsubscribe } from '../ChatTransport';

/** `id` names one negotiation attempt. Receivers ignore messages from an older attempt, so the server must relay it unchanged. */
export type SignalMessage =
  | { kind: 'offer'; id: string; sdp: string }
  | { kind: 'answer'; id: string; sdp: string }
  | { kind: 'candidate'; id: string; candidate: RTCIceCandidateInit };

/**
 * What the WebRTC transport needs from a signaling server.
 * The demo implements it with BroadcastChannel; production implements it over a WebSocket.
 * The server only relays these messages between the two people in a session.
 */
export interface SignalingClient {
  /** Enter the session's room. Leaves any previous room first. */
  join(sessionId: string): void;
  leave(): void;
  /** Relay a message to the other person in the room. */
  send(message: SignalMessage): void;
  /** Someone entered after me, so I am the one who makes the offer. */
  onPeerJoined(cb: () => void): Unsubscribe;
  onPeerLeft(cb: () => void): Unsubscribe;
  onSignal(cb: (message: SignalMessage) => void): Unsubscribe;
}
