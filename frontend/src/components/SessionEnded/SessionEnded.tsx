import type { EndedBy } from '../../hooks/useChat';
import './SessionEnded.css';

interface Props {
  endedBy: EndedBy | null;
  peerName: string;
  onRestart: () => void;
}

export default function SessionEnded({ endedBy, peerName, onRestart }: Props) {
  return (
    <div className="ended">
      <h2 className="ended__title">{endedBy === 'peer' ? `${peerName} ended the session` : 'Session ended'}</h2>
      <p className="ended__text">Every message was deleted. Nothing from this conversation is kept on this device.</p>
      <button type="button" className="ended__button" onClick={onRestart}>
        Start a new session
      </button>
    </div>
  );
}
