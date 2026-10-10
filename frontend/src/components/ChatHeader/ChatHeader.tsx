import BrandMark from '../BrandMark/BrandMark';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import type { Theme } from '../../hooks/useTheme';
import type { ConnectionStatus, User } from '../../types/chat';
import './ChatHeader.css';

interface Props {
  peer: User;
  status: ConnectionStatus;
  peerOnline: boolean;
  ended: boolean;
  onInvite: () => void;
  onEndSession: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ChatHeader({ peer, status, peerOnline, ended, onInvite, onEndSession, theme, onToggleTheme }: Props) {
  const peerAway = status === 'connected' && !peerOnline;
  const dot = peerAway ? 'away' : status;
  const label = peerAway
    ? `${peer.name} disconnected`
    : status === 'connecting'
      ? `Connecting to ${peer.name}…`
      : status === 'connected'
        ? `Connected with ${peer.name}`
        : 'Not connected';

  return (
    <header className="header">
      <BrandMark />
      <div className="header__info">
        <h1 className="header__name">Hermes Route</h1>
        <p className="header__status" role="status">
          <span className={`header__dot header__dot--${dot}`} aria-hidden="true" />
          {label}
        </p>
      </div>
      <button type="button" className="header__action" onClick={onInvite} disabled={ended}>
        Invite
      </button>
      <button type="button" className="header__action" onClick={onEndSession} disabled={ended}>
        End session
      </button>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
  );
}
