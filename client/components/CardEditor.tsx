'use client';
/**
 * Einfacher Karten-Editor (Konzept 8d.3): Titel und Text mit Absätzen, Fett/Kursiv, Listen, Link und Quelle. Der Text
 * erscheint wie auf der Karte (RichText, Menü über der Markierung); die Markdown-Ansicht gibt es nur für Profis und Notfälle. Beim Einsetzen gelten die Regeln des Projekts:
 * - Text aus dem Projekt (Herkunftsmarke, lib/clip.ts) ist immer erlaubt; die Herkunft lässt sich als Zuschreibung anfügen.
 * - Text von außen kommt ins Einfüge-Protokoll (lib/usePasteGuard.ts); über der Grenze wird er je nach Einstellung
 *   einfach eingesetzt, nach der Herkunft gefragt („später“ ist erlaubt) oder abgewiesen.
 */
import { useEffect, useRef, useState } from 'react';
import { usePasteRules } from '@/lib/pasteRules';
import type { MapCard, MapOp } from '@/lib/types';
import { usePasteGuard } from '@/lib/usePasteGuard';
import e from './cardeditor.module.css';
import { PasteNotes } from './PasteNotes';
import { RichText } from './RichText';

const MD_KEY = 'collegare-editor-markdown';


export function CardEditor({ card, onClose, send }: { card: MapCard; onClose: () => void; send: (op: MapOp) => Promise<boolean> }) {
  const rules = usePasteRules();
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const isCard = card.kind === 'card';
  // Hinweise unter dem Text: Herkunft aus dem Projekt, abgewiesenes Einsetzen, Frage nach der Herkunft
  const guard = usePasteGuard(rules, `card:${card.id}`, () => `${isCard ? 'Karte' : 'Cluster'} „${(title || card.title || 'Ohne Titel').slice(0, 120)}“`);
  const onPaste = guard.onPaste;
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
              <button type="button" className={`btn ${e.mdToggle} ${markdown ? 'on' : ''}`} onClick={toggleMarkdown} aria-pressed={markdown} title="Markdown">
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

        <PasteNotes
          g={guard}
          onAttribute={isCard ? (o) => setText((t) => (t.trimEnd() + `\n(aus ${o.from}, ${o.by})`).slice(0, 5000)) : undefined}
          onCite={isCard ? source : undefined}
          citeLabel="Angeben und als Quelle in die Karte"
        />

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
