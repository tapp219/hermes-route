import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import './MessageInput.css';

interface Props {
  disabled: boolean;
  disabledReason?: string;
  onSend: (text: string) => void;
  onTyping?: () => void;
}

export default function MessageInput({ disabled, disabledReason, onSend, onTyping }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <label htmlFor="message-input" className="sr-only">Message</label>
      <textarea
        id="message-input"
        ref={ref}
        className="composer__field"
        rows={1}
        maxLength={4000}
        value={text}
        placeholder={disabled ? (disabledReason ?? 'Waiting for connection…') : 'Write a message'}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value) onTyping?.();
          resize();
        }}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="composer__send" onClick={submit} disabled={disabled || !text.trim()}>
        Send
      </button>
    </div>
  );
}
