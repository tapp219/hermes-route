import { useState } from 'react';
import ChatWindow from '../ChatWindow/ChatWindow';
import { useChat } from '../../hooks/useChat';
import { PEER, createTransport } from '../../services';
import { buildInviteLink } from '../../utils/sessionLink';
import type { Theme } from '../../hooks/useTheme';

interface Props {
  /** Present when joining through an invite link; absent when starting a new session. */
  sessionId?: string;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ChatSession({ sessionId, theme, onToggleTheme }: Props) {
  // Swap the demo signaling for a WebSocket client when the backend exists.
  const [transport] = useState(createTransport);
  const chat = useChat(transport, sessionId);

  return (
    <ChatWindow
      peer={PEER}
      messages={chat.messages}
      status={chat.status}
      peerTyping={chat.peerTyping}
      ended={chat.ended}
      endedBy={chat.endedBy}
      peerOnline={chat.peerOnline}
      inviteLink={buildInviteLink(chat.sessionId)}
      onSend={chat.send}
      onTyping={chat.signalTyping}
      onEndSession={chat.endSession}
      onStartSession={chat.startSession}
      theme={theme}
      onToggleTheme={onToggleTheme}
    />
  );
}
