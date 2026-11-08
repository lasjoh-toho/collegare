'use client';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';

/** Tag/Nacht-Schalter: unten im Seitenmenü (wide) und im Portal (compact). */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useTheme();
  if (compact)
    return (
      <button className="btn icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Tagmodus' : 'Nachtmodus'} aria-label={theme === 'dark' ? 'Tagmodus' : 'Nachtmodus'}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
    );
  return (
    <div className="seg" role="group" aria-label="Darstellung">
      <button className={`btn ${theme === 'light' ? 'on' : ''}`} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
        <Icon name="sun" size={14} /> Tag
      </button>
      <button className={`btn ${theme === 'dark' ? 'on' : ''}`} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
        <Icon name="moon" size={14} /> Nacht
      </button>
    </div>
  );
}
