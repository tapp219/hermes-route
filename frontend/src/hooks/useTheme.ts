import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'hermes-route-theme';
const QUERY = '(prefers-color-scheme: dark)';

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Returns null when the browser cannot report a preference. */
function readSystem(): Theme | null {
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY).matches ? 'dark' : 'light';
}

/**
 * Priority: the user's saved choice > the system theme > light.
 * The system theme is followed live until the user toggles manually.
 */
export function useTheme() {
  const [stored, setStored] = useState<Theme | null>(readStored);
  const [system, setSystem] = useState<Theme | null>(readSystem);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = stored ?? system ?? 'light';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }, [theme]);

  return { theme, toggle };
}
