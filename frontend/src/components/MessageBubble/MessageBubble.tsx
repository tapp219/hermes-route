import { formatTime } from '../../utils/formatTime';
import type { Message } from '../../types/chat';
import './MessageBubble.css';

interface Props {
  message: Message;
  peerName: string;
}

export default function MessageBubble({ message, peerName }: Props) {
  const who = message.author === 'self' ? 'You' : peerName;
  return (
    <div className={`bubble bubble--${message.author}`}>
      <span className="sr-only">{who}: </span>
      <p className="bubble__text">{message.text}</p>
      <time className="bubble__time" dateTime={new Date(message.timestamp).toISOString()}>
        {formatTime(message.timestamp)}
      </time>
    </div>
  );
}
