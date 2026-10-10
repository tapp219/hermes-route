import { useEffect, useRef } from 'react';
import MessageBubble from '../MessageBubble/MessageBubble';
import TypingIndicator from '../TypingIndicator/TypingIndicator';
import type { Message, User } from '../../types/chat';
import './MessageList.css';

interface Props {
  messages: Message[];
  peer: User;
  peerTyping: boolean;
}

export default function MessageList({ messages, peer, peerTyping }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, peerTyping]);

  return (
    <div className="messages" ref={ref} role="log" aria-live="polite" aria-label={`Conversation with ${peer.name}`}>
      {messages.length === 0 && !peerTyping && <p className="messages__empty">No messages yet. Anything you send here is deleted when the session ends.</p>}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} peerName={peer.name} />
      ))}
      {peerTyping && <TypingIndicator name={peer.name} />}
    </div>
  );
}
