'use client';
/**
 * Einfacher Karten-Editor (Konzept 8d.3): Titel und Text mit Absätzen, Fett/Kursiv, Listen, Link und Quelle. Der Text
 * erscheint wie auf der Karte (RichText, Menü über der Markierung); die Markdown-Ansicht gibt es nur für Profis und Notfälle. Beim Einsetzen gelten die Regeln des Projekts:
 * - Text aus dem Projekt (Herkunftsmarke, lib/clip.ts) ist immer erlaubt; die Herkunft lässt sich als Zuschreibung anfügen.
 * - Text von außen ab der Schwelle kommt ins Einfüge-Protokoll; je nach Einstellung wird er einfach eingesetzt, nach der
 *   Herkunft gefragt („später“ ist erlaubt) oder abgewiesen.
 */
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { post } from '@/lib/api';
import { clipOrigin, type ClipMark } from '@/lib/clip';
import { PASTE_ANSWERS, usePasteRules } from '@/lib/pasteRules';
import type { MapCard, MapOp } from '@/lib/types';
import e from './cardeditor.module.css';
import { RichText } from './RichText';

const MD_KEY = 'collegare-editor-markdown';

type Answer = (typeof PASTE_ANSWERS)[number]['key'];
const fmt = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function CardEditor({ card, onClose, send }: { card: MapCard; onClose: () => void; send: (op: MapOp) => Promise<boolean> }) {
  const rules = usePasteRules();
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  const area = useRef<HTMLTextAreaElement>(null);
  // Hinweise unter dem Text: Herkunft aus dem Projekt, abgewiesenes Einsetzen, Frage nach der Herkunft
  const [origin, setOrigin] = useState<ClipMark | null>(null);
  const [warn, setWarn] = useState('');
  const [ask, setAsk] = useState<{ id: number | null; open: boolean } | null>(null);
  const [answer, setAnswer] = useState<Answer>('quote');
  const [note, setNote] = useState('');
  const [cite, setCite] = useState(true);
  const isCard = card.kind === 'card';
  const [markdown, setMarkdown] = useState(false);
  useEffect(() => {
    try {
      setMarkdown(localStorage.getItem(MD_KEY) === '1');
    } catch {
      /* ohne Speicher: WYSIWYG */
    }
  }, []);
  function toggleMarkdown() {
    setMarkdown(!markdown);
    try {
      localStorage.setItem(MD_KEY, markdown ? '0' : '1');
    } catch {
      /* egal */
    }
  }

  async function save() {
    if (title !== card.title || text !== card.text) {
      const ok = await send({ type: 'update', id: card.id, patch: isCard ? { title, text } : { title } });
      if (!ok) return;
    }
    onClose();
  }

  /** Auswahl im Textfeld ersetzen und danach markieren (für die Knöpfe) */
  function edit(fn: (sel: string) => { insert: string; selFrom?: number; selTo?: number }, placeholder = '') {
    const ta = area.current;
    if (!ta) return;
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const sel = text.slice(a, b) || placeholder;
    const r = fn(sel);
    const next = text.slice(0, a) + r.insert + text.slice(b);
    setText(next.slice(0, 5000));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(a + (r.selFrom ?? 0), a + (r.selTo ?? r.insert.length));
    });
  }
  const wrap = (mark: string, ph: string) => edit((s) => ({ insert: mark + s + mark, selFrom: mark.length, selTo: mark.length + s.length }), ph);
  const list = (ordered: boolean) =>
    edit((s) => {
      const lines = (s || 'Punkt').split('\n');
      const insert = lines.map((l, i) => (ordered ? `${i + 1}. ` : '- ') + l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')).join('\n');
      return { insert };
    });
  const link = () => edit((s) => ({ insert: `[${s}](https://)`, selFrom: s.length + 3, selTo: s.length + 11 }), 'Linktext');
  function source(value = '') {
    const line = `Quelle: ${value}`;
    const next = (text.trimEnd() ? text.trimEnd() + '\n' : '') + line;
    setText(next.slice(0, 5000));
    requestAnimationFrame(() => {
      const ta = area.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(next.length, next.length);
    });
  }

  function onPaste(ev: ClipboardEvent<HTMLElement>) {
    if (!rules) return;
    const pasted = ev.clipboardData.getData('text/plain');
    if (!pasted.trim()) return;
    const from = clipOrigin(ev.clipboardData, rules.projectId, pasted);
    setWarn('');
    if (from) {
      setOrigin(from);
      return;
    }
    if ([...pasted].length < rules.threshold) return;
    if (rules.outside === 'limit') {
      ev.preventDefault();
      setWarn(`Von außen lassen sich hier höchstens ${rules.threshold - 1} Zeichen auf einmal einsetzen. Schreib den Gedanken in eigenen Worten oder zitiere eine kurze Stelle mit Quelle.`);
      return;
    }
    const place = `${isCard ? 'Karte' : 'Cluster'} „${(title || card.title || 'Ohne Titel').slice(0, 120)}“`;
    setAnswer('quote');
    setNote('');
    setAsk({ id: null, open: rules.outside === 'ask' });
    post<{ id: number }>(`/api/projects/${rules.projectId}/einfuegen`, { scope: rules.scope, place, text: pasted }).then(
      (r) => setAsk((cur) => (cur ? { ...cur, id: r.id } : cur)),
      () => setAsk((cur) => cur),
    );
  }

  async function answerPaste() {
    if (!rules || !ask) return;
    if (ask.id !== null) await post(`/api/projects/${rules.projectId}/einfuegen/${ask.id}`, { answer, note: note.trim() }).catch(() => {});
    if (answer === 'quote' && cite && note.trim()) source(note.trim());
    setAsk(null);
  }

  return (
    <div className="modal-bg" data-ui onPointerDown={(ev) => (ev.stopPropagation(), ev.target === ev.currentTarget && void save())}>
      <div
        className={`modal ${e.modal}`}
        role="dialog"
        data-clip={`${isCard ? 'Karte' : 'Cluster'} „${card.title || 'Ohne Titel'}“`}
        aria-label={isCard ? 'Karte bearbeiten' : 'Cluster benennen'}
        onKeyDown={(ev) => (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) ? void save() : ev.key === 'Escape' && onClose())}
      >
        <h2>{isCard ? 'Karte' : 'Cluster benennen'}</h2>
        <div className="field">
          <label>Titel</label>
          <input value={title} onChange={(ev) => setTitle(ev.target.value)} onPaste={onPaste} maxLength={200} autoFocus onKeyDown={(ev) => ev.key === 'Enter' && !isCard && void save()} />
        </div>
        {isCard && (
          <div className="field">
            <div className="row">
              <label className="grow">Text</label>
              <button type="button" className={`btn ${e.mdToggle} ${markdown ? 'on' : ''}`} onClick={toggleMarkdown} aria-pressed={markdown} title="Text als Markdown bearbeiten (für Profis)">
                Markdown
              </button>
            </div>
            {markdown ? (
              <>
                <div className={e.tools} role="toolbar" aria-label="Auszeichnen">
                  <button type="button" className="btn" onClick={() => wrap('**', 'fett')} title="Fett (**…**)">
                    <b>F</b>
                  </button>
                  <button type="button" className="btn" onClick={() => wrap('*', 'kursiv')} title="Kursiv (*…*)">
                    <i>K</i>
                  </button>
                  <button type="button" className="btn" onClick={() => list(false)} title="Liste mit Punkten">
                    • Liste
                  </button>
                  <button type="button" className="btn" onClick={() => list(true)} title="Nummerierte Liste">
                    1. Liste
                  </button>
                  <button type="button" className="btn" onClick={link} title="Link ([Text](https://…))">
                    Link
                  </button>
                  <button type="button" className="btn" onClick={() => source()} title="Zeile „Quelle:“ anfügen">
                    Quelle
                  </button>
                </div>
                <textarea ref={area} rows={8} value={text} onChange={(ev) => setText(ev.target.value)} onPaste={onPaste} maxLength={5000} className={e.md} />
              </>
            ) : (
              <RichText value={text} onChange={setText} onPaste={onPaste} label="Text der Karte" pinKey="collegare-editor-leiste-karte" defaultPinned />
            )}
          </div>
        )}

        {origin && (
          <div className={e.note} role="status">
            <span>
              Eingesetzt aus {origin.from} ({origin.by}, {fmt(origin.at)}).
            </span>
            {isCard && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setText((t) => (t.trimEnd() + `\n(aus ${origin.from}, ${origin.by})`).slice(0, 5000));
                  setOrigin(null);
                }}
              >
                Zuschreibung anfügen
              </button>
            )}
            <button type="button" className="btn icon" onClick={() => setOrigin(null)} aria-label="Hinweis schließen">
              ×
            </button>
          </div>
        )}
        {warn && (
          <div className={`${e.note} ${e.warn}`} role="alert">
            <span>{warn}</span>
            <button type="button" className="btn icon" onClick={() => setWarn('')} aria-label="Hinweis schließen">
              ×
            </button>
          </div>
        )}
        {ask && !ask.open && (
          <div className={e.note} role="status">
            <span>Eingesetzter Text von außen steht unter „Arbeitsprozess“.</span>
            <button type="button" className="btn" onClick={() => setAsk({ ...ask, open: true })}>
              Herkunft angeben
            </button>
            <button type="button" className="btn icon" onClick={() => setAsk(null)} aria-label="Hinweis schließen">
              ×
            </button>
          </div>
        )}
        {ask?.open && (
          <fieldset className={e.ask}>
            <legend>Woher stammt der eingesetzte Text?</legend>
            {PASTE_ANSWERS.map((o) => (
              <label key={o.key} className={e.opt}>
                <input type="radio" name="herkunft" checked={answer === o.key} onChange={() => setAnswer(o.key)} /> {o.label}
              </label>
            ))}
            <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} placeholder={PASTE_ANSWERS.find((o) => o.key === answer)?.hint} aria-label="Angabe zur Herkunft" />
            {answer === 'quote' && isCard && (
              <label className={e.opt}>
                <input type="checkbox" checked={cite} onChange={(ev) => setCite(ev.target.checked)} /> als „Quelle:“ in die Karte schreiben
              </label>
            )}
            <div className="row">
              <span className="muted">Du kannst auch später antworten (unter „Arbeitsprozess“).</span>
              <span className="grow" />
              <button type="button" className="btn" onClick={() => setAsk(null)}>
                Später
              </button>
              <button type="button" className="btn primary" onClick={() => void answerPaste()}>
                Angeben
              </button>
            </div>
          </fieldset>
        )}

        <div className="row">
          <span className="muted">Strg+Enter speichert</span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
