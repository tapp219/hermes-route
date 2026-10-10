import { useState } from 'react';
import ChatHeader from '../ChatHeader/ChatHeader';
import InviteDialog from '../InviteDialog/InviteDialog';
import MessageList from '../MessageList/MessageList';
import MessageInput from '../MessageInput/MessageInput';
import SessionEnded from '../SessionEnded/SessionEnded';
import type { EndedBy } from '../../hooks/useChat';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionStatus, Message, User } from '../../types/chat';
import './ChatWindow.css';

interface Props {
  peer: User;
  messages: Message[];
  status: ConnectionStatus;
  peerOnline: boolean;
  peerTyping: boolean;
  ended: boolean;
  endedBy: EndedBy | null;
  inviteLink: string;
  onSend: (text: string) => void;
  onTyping: () => void;
  onEndSession: () => void;
  onStartSession: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ChatWindow({ peer, messages, status, peerOnline, peerTyping, ended, endedBy, inviteLink, onSend, onTyping, onEndSession, onStartSession, theme, onToggleTheme }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);

  const disabledReason =
    status !== 'connected'
      ? 'Waiting for connection…'
      : !peerOnline
        ? `${peer.name} has disconnected. Waiting for them to rejoin…`
        : undefined;

  return (
    <main className="chat">
      <ChatHeader peer={peer} status={status} peerOnline={peerOnline} ended={ended} onInvite={() => setInviteOpen(true)} onEndSession={onEndSession} theme={theme} onToggleTheme={onToggleTheme} />
      {ended ? (
        <SessionEnded endedBy={endedBy} peerName={peer.name} onRestart={onStartSession} />
      ) : (
        <>
          <p className="privacy-note">Private session. Messages stay in this window and are deleted when it ends.</p>
          <MessageList messages={messages} peer={peer} peerTyping={peerTyping} />
          <MessageInput disabled={disabledReason !== undefined} disabledReason={disabledReason} onSend={onSend} onTyping={onTyping} />
        </>
      )}
      <InviteDialog open={inviteOpen && !ended} link={inviteLink} onClose={() => setInviteOpen(false)} />
    </main>
  );
}
