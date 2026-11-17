'use client';
/**
 * Auswahl der Präsentation in der Mitte der Kopfzeile (Wunsch Jo, 17. November 2026): statt „Gruppe / Titel“ und der
 * Auswahl „Test / Demo (nur für mich | Lernende sehen sie)“ ein Auswahlfeld mit den Titeln der Präsentationen. Den Titel
 * der eigenen Präsentation ändert man direkt darin. Hinter jeder Präsentation zeigt ein Auge, ob sie für alle
 * freigeschaltet ist, dahinter ein Schloss, ob jemand die Bearbeitung gesperrt hat. Daneben stehen „Veröffentlichen“
 * (Auswahl mit Symbolen) und „Bearbeitung sperren“.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import s from './folien.module.css';

export interface DeckInfo {
  scope: string;
  docId: number;
  title: string;
  /** Gruppe, Person oder Lehrkraft, der die Präsentation gehört („Nur du“ für den eigenen Testbereich) */
  owner: string;
  shared: boolean;
  lockedBy: number | null;
  lockedByName: string | null;
  /** die eigene: Gruppe der Lernenden bzw. Testbereich der Lehrkraft */
  mine: boolean;
  test: boolean;
  done: boolean;
}

interface Props {
  decks: DeckInfo[];
  current: DeckInfo | null;
  teacher: boolean;
  meId: number;
  /** Titel, wie Bento ihn gerade meldet */
  title: string;
  editing: boolean;
  dirty: boolean;
  canShare: boolean;
  canLock: boolean;
  canUnlock: boolean;
  onChoose: (scope: string) => void;
  onRename: (title: string) => void;
  onSave: () => void;
  onShare: (shared: boolean) => void;
  onLock: (locked: boolean) => void;
}

/** Wer die Präsentation sieht: die Lehrkraft sieht immer alle */
function shareLabels(d: DeckInfo, teacher: boolean): { off: string; on: string } {
  if (d.test && teacher) return { off: 'Nur für mich', on: 'Für alle freigeschaltet' };
  if (d.scope.startsWith('u')) return { off: 'Nur ich und die Lehrkraft', on: 'Für alle im Projekt' };
  return { off: 'Gruppe und Lehrkraft', on: 'Für alle im Projekt' };
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Klicks in die Präsentation (iframe) erreichen dieses Fenster nicht: beim Verlassen des Fensters schließen
    const blur = () => close();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [open, close]);
  return ref;
}

function StateIcons({ d, meId }: { d: DeckInfo; meId: number }) {
  const lockTip = d.lockedBy === null ? '' : d.lockedBy === meId ? 'Bearbeitung gesperrt von dir' : `Bearbeitung gesperrt von ${d.lockedByName ?? 'jemand anderem'}`;
  return (
    <span className={s.stateIcons}>
      <span className={d.shared ? s.stateOn : s.stateOff} title={d.shared ? 'Für alle freigeschaltet' : 'Nicht freigeschaltet'}>
        <Icon name={d.shared ? 'eye' : 'eyeOff'} size={14} />
      </span>
      {d.lockedBy !== null && (
        <span className={s.stateLock} title={lockTip}>
          <Icon name="lock" size={13} />
        </span>
      )}
      {d.done && (
        <span className={s.stateOn} title="Als fertig markiert">
          <Icon name="check" size={13} />
        </span>
      )}
    </span>
  );
}

export function DeckPicker(p: Props) {
  const [open, setOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const pickRef = useOutside(open, () => setOpen(false));
  const shareRef = useOutside(shareOpen, () => setShareOpen(false));
  const d = p.current;
  if (!d) return null;
  const title = p.title || d.title;
  const labels = shareLabels(d, p.teacher);
  const groups: { label: string; items: DeckInfo[] }[] = [
    { label: p.teacher ? 'Eigene' : 'Eure Präsentation', items: p.decks.filter((x) => x.mine) },
    { label: 'Gruppen', items: p.decks.filter((x) => !x.mine && p.teacher) },
    { label: 'Von anderen freigeschaltet', items: p.decks.filter((x) => !x.mine && !p.teacher) },
  ].filter((g) => g.items.length);
  const lockedByOther = d.lockedBy !== null && d.lockedBy !== p.meId;
  const lockTitle =
    d.lockedBy === null
      ? 'Bearbeitung sperren – für alle anderen, auch für Gruppenmitglieder!'
      : d.lockedBy === p.meId
        ? 'Gesperrt von dir: nur du kannst ändern. Klicken zum Entsperren.'
        : `Gesperrt von ${d.lockedByName ?? 'jemand anderem'}` + (p.canUnlock ? '. Klicken zum Entsperren.' : '');

  return (
    <div className={s.picker}>
      <div className={s.pickWrap} ref={pickRef}>
        <div className={`${s.pickBox} ${open ? s.pickOpen : ''}`}>
          {p.editing ? (
            <input
              key={title}
              className={s.title}
              defaultValue={title}
              aria-label="Titel der Präsentation"
              title="Titel der Präsentation – hier umbenennen"
              size={Math.min(Math.max(title.length, 8), 36)}
              onBlur={(e) => {
                const t = e.target.value.trim();
                if (t && t !== title) p.onRename(t);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className={s.titleRead} onClick={() => setOpen((o) => !o)} title={`${title} (${d.owner})`}>
              {title}
            </button>
          )}
          {!d.mine && <span className={s.owner}>{d.owner}</span>}
          <button className={s.pickBtn} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Andere Präsentation wählen" aria-label="Präsentation wählen">
            <Icon name="chevronDown" size={15} />
          </button>
        </div>
        {open && (
          <div className={s.pickMenu} role="listbox" aria-label="Präsentationen">
            {groups.map((g) => (
              <div key={g.label}>
                <div className={s.pickHead}>{g.label}</div>
                {g.items.map((x) => (
                  <button
                    key={x.scope}
                    role="option"
                    aria-selected={x.scope === d.scope}
                    className={`${s.pickItem} ${x.scope === d.scope ? s.pickHere : ''}`}
                    onClick={() => {
                      setOpen(false);
                      if (x.scope !== d.scope) p.onChoose(x.scope);
                    }}
                  >
                    <span className={s.pickText}>
                      <span className={s.pickTitle}>{x.scope === d.scope ? title : x.title}</span>
                      <span className={s.pickOwner}>{x.owner}</span>
                    </span>
                    <StateIcons d={x} meId={p.meId} />
                  </button>
                ))}
              </div>
            ))}
            {!p.teacher && groups.length === 1 && <div className={s.pickEmpty}>Andere Gruppen haben noch nichts freigeschaltet.</div>}
          </div>
        )}
      </div>

      {/* Veröffentlichen: Auge hinter der Präsentation (für alle gleich, auch die Lehrkraft) */}
      <div className={s.pickWrap} ref={shareRef}>
        <button
          className={`btn icon ${s.stateBtn} ${d.shared ? s.stateBtnOn : ''}`}
          onClick={() => p.canShare && setShareOpen((o) => !o)}
          disabled={!p.canShare}
          aria-haspopup="menu"
          aria-expanded={shareOpen}
          title={`Veröffentlichen: ${d.shared ? labels.on : labels.off}`}
          aria-label="Veröffentlichen"
        >
          <Icon name={d.shared ? 'eye' : 'eyeOff'} size={16} />
        </button>
        {shareOpen && (
          <div className={`${s.pickMenu} ${s.shareMenu}`} role="menu" aria-label="Veröffentlichen">
            <div className={s.pickHead}>Veröffentlichen</div>
            {[false, true].map((on) => (
              <button
                key={String(on)}
                role="menuitemradio"
                aria-checked={d.shared === on}
                className={`${s.pickItem} ${d.shared === on ? s.pickHere : ''}`}
                onClick={() => {
                  setShareOpen(false);
                  if (d.shared !== on) p.onShare(on);
                }}
              >
                <Icon name={on ? 'eye' : d.test && p.teacher ? 'eyeOff' : 'users'} size={16} />
                <span className={s.pickText}>
                  <span className={s.pickTitle}>{on ? labels.on : labels.off}</span>
                  <span className={s.pickOwner}>{on ? (p.teacher && d.test ? 'Alle Lernenden sehen sie, nur lesend' : 'Alle Gruppen sehen sie, nur lesend') : 'Andere Gruppen sehen sie nicht'}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bearbeitung sperren: Schloss dahinter; von jemand anderem gesperrt: Schloss mit Namen */}
      {lockedByOther ? (
        <button className={s.lockChip} onClick={() => p.canUnlock && p.onLock(false)} disabled={!p.canUnlock} title={lockTitle} aria-label={lockTitle}>
          <Icon name="lock" size={14} />
          <span className={s.lockName}>{d.lockedByName ?? 'gesperrt'}</span>
        </button>
      ) : (
        p.canLock && (
          <button
            className={`btn icon ${s.stateBtn} ${d.lockedBy !== null ? s.stateBtnLock : ''}`}
            onClick={() => p.onLock(d.lockedBy === null)}
            aria-pressed={d.lockedBy !== null}
            title={lockTitle}
            aria-label={d.lockedBy === null ? 'Bearbeitung sperren' : 'Bearbeitung entsperren'}
          >
            <Icon name={d.lockedBy !== null ? 'lock' : 'unlock'} size={16} />
          </button>
        )
      )}

      {p.editing &&
        (p.dirty ? (
          <button className={s.unsaved} onClick={p.onSave} title="Nicht gespeichert – jetzt speichern" aria-label="Nicht gespeichert, jetzt speichern" />
        ) : (
          <span className={s.saved} title="Gespeichert" aria-label="Gespeichert">
            ✓
          </span>
        ))}
    </div>
  );
}
