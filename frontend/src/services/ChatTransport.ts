import type { ConnectionStatus, Message } from '../types/chat';

export type Unsubscribe = () => void;

/**
 * The only thing the UI knows about the network.
 * Implement this with WebSocket or WebRTC later; no component changes needed.
 * `onMessage` delivers messages from the peer only (own messages are added locally).
 */
export interface ChatTransport {
  /** Join the session with this id. Called again with a new id for each new session. */
  connect(sessionId: string): void;
  /** Close the connection. Also used for cleanup, so the peer sees a disconnect, not an end. */
  disconnect(): void;
  /** Tell the peer the session is over, then disconnect. */
  endSession(): void;
  send(text: string): void;
  /** Tell the peer the local person started or stopped typing. */
  sendTyping(isTyping: boolean): void;
  onMessage(cb: (message: Message) => void): Unsubscribe;
  onTyping(cb: (isTyping: boolean) => void): Unsubscribe;
  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe;
  /** The peer went offline (false) or came back (true). Your own connection is `onStatus`. */
  onPeerPresence(cb: (online: boolean) => void): Unsubscribe;
  /** The peer ended the session. The transport must already be closed when this fires. */
  onSessionEnded(cb: () => void): Unsubscribe;
}
