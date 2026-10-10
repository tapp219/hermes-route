import { useCallback, useEffect, useRef, useState } from 'react';
import { createSessionId } from '../utils/sessionId';
import type { ChatTransport } from '../services/ChatTransport';
import type { ConnectionStatus, Message } from '../types/chat';

export type EndedBy = 'self' | 'peer';

/**
 * Messages live only in React state: nothing is written to storage, so a
 * refresh or closed tab also ends the session and discards the conversation.
 */
export function useChat(transport: ChatTransport, initialSessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(true);
  const [endedBy, setEndedBy] = useState<EndedBy | null>(null);
  const [sessionId, setSessionId] = useState(() => initialSessionId ?? createSessionId());
  const typingIdle = useRef(0);
  const typingSentAt = useRef(0);

  useEffect(() => {
    const unsubs = [
      transport.onMessage((m) => setMessages((prev) => [...prev, m])),
      transport.onTyping(setPeerTyping),
      transport.onStatus(setStatus),
      transport.onPeerPresence(setPeerOnline),
      transport.onSessionEnded(() => {
        transport.disconnect();
        setMessages([]);
        setPeerTyping(false);
        setEndedBy('peer');
      }),
    ];
    // Later sessions connect from startSession, so only the first id matters here.
    transport.connect(sessionId);
    return () => {
      window.clearTimeout(typingIdle.current);
      unsubs.forEach((off) => off());
      transport.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  const stopTyping = useCallback(() => {
    window.clearTimeout(typingIdle.current);
    if (typingSentAt.current) {
      typingSentAt.current = 0;
      transport.sendTyping(false);
    }
  }, [transport]);

  /** Call on every keystroke; sends at most one "typing" signal every 2.5 seconds. */
  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingSentAt.current > 2500) {
      typingSentAt.current = now;
      transport.sendTyping(true);
    }
    window.clearTimeout(typingIdle.current);
    typingIdle.current = window.setTimeout(stopTyping, 3000);
  }, [transport, stopTyping]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status !== 'connected' || !peerOnline) return;
      stopTyping();
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), author: 'self', text: trimmed, timestamp: Date.now() },
      ]);
      transport.send(trimmed);
    },
    [transport, status, peerOnline, stopTyping],
  );

  /** Tells the peer, disconnects and discards every message. */
  const endSession = useCallback(() => {
    window.clearTimeout(typingIdle.current);
    transport.endSession();
    setMessages([]);
    setPeerTyping(false);
    setEndedBy('self');
  }, [transport]);

  const startSession = useCallback(() => {
    const id = createSessionId();
    setSessionId(id);
    setPeerOnline(true);
    setEndedBy(null);
    transport.connect(id);
  }, [transport]);

  return {
    messages,
    status,
    peerTyping,
    peerOnline,
    ended: endedBy !== null,
    endedBy,
    sessionId,
    send,
    signalTyping,
    endSession,
    startSession,
  };
}
