import './TypingIndicator.css';

export default function TypingIndicator({ name }: { name: string }) {
  return (
    <div className="typing" aria-label={`${name} is typing`}>
      <span /><span /><span />
    </div>
  );
}
