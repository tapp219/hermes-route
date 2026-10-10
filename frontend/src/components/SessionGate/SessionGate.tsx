import BrandMark from '../BrandMark/BrandMark';
import './SessionGate.css';

export type GateState = 'joining' | 'expired' | 'invalid' | 'full';

const COPY: Record<GateState, { title: string; text: string }> = {
  joining: { title: 'Joining session…', text: 'Checking your invite link.' },
  expired: { title: 'This session has ended', text: 'The link no longer works. Sessions and their messages are deleted when they end.' },
  full: { title: 'This session is full', text: 'Only two people can be in a session. Ask for a new invite, or start your own.' },
  invalid: { title: 'This link is not valid', text: 'Check that the whole link was copied, or ask for a new invite.' },
};

export default function SessionGate({ state, leaving = false, onStartNew }: { state: GateState; leaving?: boolean; onStartNew: () => void }) {
  const { title, text } = COPY[state];
  return (
    <main className={`gate${leaving ? ' gate--leaving' : ''}`}>
      <BrandMark size={48} />
      <h1 className="gate__title" role={state === 'joining' ? 'status' : undefined}>{title}</h1>
      <p className="gate__text">{text}</p>
      {state !== 'joining' && (
        <button type="button" className="gate__button" onClick={onStartNew}>
          Start a new session
        </button>
      )}
    </main>
  );
}
