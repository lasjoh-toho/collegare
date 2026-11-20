'use client';
/** Hinweise unter einem Editor nach dem Einsetzen (lib/usePasteGuard.ts): Herkunft aus dem Projekt, abgewiesen, Frage nach der Herkunft */
import type { ClipMark } from '@/lib/clip';
import { CITE_RULE, PASTE_ANSWERS } from '@/lib/pasteRules';
import type { PasteGuard } from '@/lib/usePasteGuard';
import { Icon } from './Icon';
import e from './cardeditor.module.css';

const fmt = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function PasteNotes({ g, onAttribute, citeLabel, onCite }: { g: PasteGuard; onAttribute?: (o: ClipMark) => void; citeLabel?: string; onCite?: (source: string) => void }) {
  const close = (fn: () => void) => (
    <button type="button" className="btn icon" onClick={fn} aria-label="Hinweis schließen">
      <Icon name="close" size={14} />
    </button>
  );
  return (
    <>
      {g.origin && (
        <div className={e.note} role="status">
          <span>
            Eingesetzt aus {g.origin.from} ({g.origin.by}, {fmt(g.origin.at)}).
          </span>
          {onAttribute && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onAttribute(g.origin!);
                g.setOrigin(null);
              }}
            >
              Zuschreibung anfügen
            </button>
          )}
          {close(() => g.setOrigin(null))}
        </div>
      )}
      {g.warn && (
        <div className={`${e.note} ${e.warn}`} role="alert">
          <span>{g.warn}</span>
          {close(() => g.setWarn(''))}
        </div>
      )}
      {g.ask && !g.ask.open && (
        <div className={e.note} role="status">
          <span>{g.ask.over ? 'Eingesetzter Text von außen steht unter „Arbeitsprozess“.' : 'Von außen eingesetzt; das steht unter „Arbeitsprozess“.'}</span>
          <button type="button" className="btn" onClick={() => g.setAsk({ ...g.ask!, open: true })}>
            Herkunft angeben
          </button>
          {close(() => g.setAsk(null))}
        </div>
      )}
      {g.ask?.open && (
        <fieldset className={e.ask}>
          <legend>Woher stammt der eingesetzte Text?</legend>
          <p className="muted">{CITE_RULE}</p>
          {PASTE_ANSWERS.map((o) => (
            <label key={o.key} className={e.opt}>
              <input type="radio" name="herkunft" checked={g.answer === o.key} onChange={() => g.setAnswer(o.key)} /> {o.label}
            </label>
          ))}
          <input value={g.note} onChange={(ev) => g.setNote(ev.target.value)} maxLength={1000} placeholder={PASTE_ANSWERS.find((o) => o.key === g.answer)?.hint} aria-label="Angabe zur Herkunft" />
          <div className="row">
            <span className="muted">Du kannst auch später antworten (unter „Arbeitsprozess“).</span>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => g.setAsk(null)}>
              Später
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (g.answer === 'quote' && onCite && g.note.trim()) onCite(g.note.trim());
                void g.answerPaste();
              }}
            >
              {g.answer === 'quote' && onCite && citeLabel ? citeLabel : 'Angeben'}
            </button>
          </div>
        </fieldset>
      )}
    </>
  );
}
