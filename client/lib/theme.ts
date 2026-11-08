'use client';
/**
 * Tag/Nacht (docs/gestaltung.md, Abschnitt 2): ohne Wahl folgt die Oberfläche dem Gerät,
 * der Schalter überschreibt das. Gespeichert im Browser; ein Konto-Feld folgt mit der gemeinsamen Verwaltung.
 */
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'collegare-theme';

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    setTheme(current());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(current());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const choose = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* privates Fenster: gilt nur bis zum Neuladen */
    }
    setTheme(t);
  };
  return [theme, choose];
}
