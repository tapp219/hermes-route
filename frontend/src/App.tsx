import { useEffect, useState } from 'react';
import ChatSession from './components/ChatSession/ChatSession';
import SessionGate from './components/SessionGate/SessionGate';
import { useTheme } from './hooks/useTheme';
import { checkSession } from './services';
import { clearSessionHash, readSessionIdFromHash } from './utils/sessionLink';
import type { SessionCheck } from './types/chat';

type Entry =
  | { phase: 'joining'; id: string }
  | { phase: 'unavailable'; reason: Exclude<SessionCheck, 'valid'> }
  | { phase: 'ready'; id?: string };

const FADE_MS = 250;

function fadeDelay(): number {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 0 : FADE_MS;
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [leaving, setLeaving] = useState(false);
  const [entry, setEntry] = useState<Entry>(() => {
    const id = readSessionIdFromHash();
    return id !== null ? { phase: 'joining', id } : { phase: 'ready' };
  });

  useEffect(() => {
    clearSessionHash();
  }, []);

  useEffect(() => {
    if (entry.phase !== 'joining') return;
    let cancelled = false;
    checkSession(entry.id).then(async (result) => {
      if (cancelled) return;
      setLeaving(true); // fade the joining screen out before swapping
      await new Promise((resolve) => setTimeout(resolve, fadeDelay()));
      if (cancelled) return;
      setLeaving(false);
      setEntry(result === 'valid' ? { phase: 'ready', id: entry.id } : { phase: 'unavailable', reason: result });
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (entry.phase === 'ready') {
    return <ChatSession sessionId={entry.id} theme={theme} onToggleTheme={toggle} />;
  }
  return (
    <SessionGate
      state={entry.phase === 'joining' ? 'joining' : entry.reason}
      leaving={leaving}
      onStartNew={() => setEntry({ phase: 'ready' })}
    />
  );
}
