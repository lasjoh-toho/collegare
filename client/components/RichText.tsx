'use client';
/**
 * Textfeld „wie in Word“ für Kartentexte (Wunsch Jo, 14. November 2026): Man sieht fett, kursiv, Listen und Links
 * gleich so, wie sie auf der Karte erscheinen. Über einer Markierung öffnet sich ein kleines Menü; es lässt sich als
 * feste Leiste über dem Text anheften. Gespeichert wird weiter das kleine Markdown aus lib/markdown.ts, damit Karten,
 * Gliederung und Export unverändert bleiben.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { htmlToMarkdown, renderMarkdown } from '@/lib/markdown';
import r from './richtext.module.css';

const PIN_KEY = 'collegare-editor-leiste';
type Cmd = 'bold' | 'italic' | 'ul' | 'ol' | 'heading' | 'link' | 'source';

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

export function RichText({
  value,
  onChange,
  onPaste,
  max = 5000,
  label,
}: {
  value: string;
  onChange: (md: string) => void;
  /** Regeln zum Einsetzen (CardEditor); ein preventDefault dort weist das Einsetzen ab */
  onPaste?: (ev: ClipboardEvent<HTMLDivElement>) => void;
  max?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [pinned, setPinned] = useState(false);
  const [float, setFloat] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [linkAsk, setLinkAsk] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    try {
      setPinned(localStorage.getItem(PIN_KEY) === '1');
    } catch {
      /* ohne Speicher: schwebendes Menü */
    }
  }, []);

  // Wert von außen (erstes Öffnen, „Zuschreibung anfügen“, „Quelle:“ aus der Herkunftsfrage) in das Feld übernehmen
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || value === emitted.current) return;
    const first = emitted.current === null;
    el.innerHTML = renderMarkdown(value);
    emitted.current = value;
    if (!first) caretToEnd(el);
  }, [value]);

  function emit() {
    const el = box.current;
    if (!el) return;
    const md = htmlToMarkdown(el);
    setTooLong(md.length > max);
    emitted.current = md.slice(0, max);
    onChange(emitted.current);
  }

  function caretToEnd(el: HTMLElement) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // Menü über der Markierung mitführen
  useEffect(() => {
    const onSel = () => {
      const el = box.current;
      const sel = getSelection();
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
        if (linkAsk === null) setFloat(null);
        return;
      }
      setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList') });
      if (sel.isCollapsed) {
        if (linkAsk === null) setFloat(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      // am Handy liegt das Menü des Systems über der Markierung, unseres darunter
      const below = matchMedia('(pointer: coarse)').matches || rect.top < 60;
      const left = Math.min(Math.max(rect.left + rect.width / 2, 150), innerWidth - 150);
      setFloat({ left, top: below ? rect.bottom + 8 : rect.top - 8, below });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [linkAsk]);

  function keep() {
    const sel = getSelection();
    if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  }
  function restore() {
    const el = box.current;
    if (!el) return;
    el.focus();
    if (saved.current) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(saved.current);
    }
  }

  function run(cmd: Cmd) {
    const el = box.current;
    if (!el) return;
    if (document.activeElement !== el) restore();
    exec('defaultParagraphSeparator', 'p');
    if (cmd === 'bold' || cmd === 'italic') exec(cmd);
    else if (cmd === 'ul') exec('insertUnorderedList');
    else if (cmd === 'ol') exec('insertOrderedList');
    else if (cmd === 'heading') {
      const block = getSelection()?.anchorNode?.parentElement?.closest('h3,h4,h5,p,div,li');
      exec('formatBlock', block && /^H/.test(block.tagName) ? 'p' : 'h3');
    } else if (cmd === 'link') {
      keep();
      setLinkAsk('https://');
      return;
    } else if (cmd === 'source') {
      caretToEnd(el);
      exec('insertHTML', `<p class="md-source">Quelle:&nbsp;</p>`);
    }
    emit();
  }

  function setLink(url: string) {
    restore();
    const ok = /^https?:\/\/\S+\.\S+/.test(url);
    if (ok) {
      const sel = getSelection();
      if (sel && sel.isCollapsed) exec('insertHTML', `<a href="${url.replace(/"/g, '%22')}">${url.replace(/[<>&]/g, '')}</a>`);
      else exec('createLink', url);
      emit();
    }
    setLinkAsk(null);
  }

  function paste(ev: ClipboardEvent<HTMLDivElement>) {
    onPaste?.(ev);
    if (ev.defaultPrevented) return;
    // nur reiner Text: Formatierung und HTML von außen kommen nie herein
    ev.preventDefault();
    const text = ev.clipboardData.getData('text/plain');
    if (text) exec('insertText', text);
    emit();
  }

  function togglePin() {
    const v = !pinned;
    setPinned(v);
    try {
      localStorage.setItem(PIN_KEY, v ? '1' : '0');
    } catch {
      /* egal */
    }
  }

  const tools = (
    <>
      <button type="button" className={`btn ${active.bold ? 'on' : ''}`} onClick={() => run('bold')} title="Fett (Strg+B)" aria-pressed={!!active.bold}>
        <b>F</b>
      </button>
      <button type="button" className={`btn ${active.italic ? 'on' : ''}`} onClick={() => run('italic')} title="Kursiv (Strg+I)" aria-pressed={!!active.italic}>
        <i>K</i>
      </button>
      <button type="button" className="btn" onClick={() => run('heading')} title="Zwischenüberschrift">
        Ü
      </button>
      <button type="button" className={`btn ${active.ul ? 'on' : ''}`} onClick={() => run('ul')} title="Liste mit Punkten">
        • Liste
      </button>
      <button type="button" className={`btn ${active.ol ? 'on' : ''}`} onClick={() => run('ol')} title="Nummerierte Liste">
        1. Liste
      </button>
      <button type="button" className="btn" onClick={() => run('link')} title="Link">
        Link
      </button>
      <button type="button" className="btn" onClick={() => run('source')} title="Zeile „Quelle:“ anfügen">
        Quelle
      </button>
    </>
  );
  const linkForm = linkAsk !== null && (
    <form
      className={r.link}
      onSubmit={(ev) => {
        ev.preventDefault();
        setLink(linkAsk.trim());
      }}
    >
      <input autoFocus value={linkAsk} onChange={(ev) => setLinkAsk(ev.target.value)} aria-label="Adresse des Links" onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), setLinkAsk(null), restore())} />
      <button type="submit" className="btn primary">
        Setzen
      </button>
      <button type="button" className="btn" onClick={() => (setLinkAsk(null), restore())}>
        Abbrechen
      </button>
    </form>
  );

  return (
    <div className={r.wrap}>
      {pinned && (
        <div className={r.bar} role="toolbar" aria-label="Auszeichnen" onMouseDown={(ev) => (ev.target as Element).closest('button') && ev.preventDefault()}>
          {tools}
          <span className="grow" />
          <button type="button" className="btn on" onClick={togglePin} title="Leiste lösen: Menü nur über der Markierung">
            📌
          </button>
        </div>
      )}
      {pinned && linkForm}
      <div
        ref={box}
        className={r.box}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder="Schreib hier. Markiere Text, um ihn fett, kursiv oder als Liste zu setzen."
        onInput={emit}
        onPaste={paste}
        onBlur={keep}
        onFocus={() => exec('defaultParagraphSeparator', 'p')}
      />
      {tooLong && <div className={r.long}>Der Text ist länger als {max} Zeichen; das Ende wird nicht gespeichert.</div>}
      {!pinned && (float || linkAsk !== null) && (
        <div
          className={`${r.float} ${float?.below ? r.below : ''}`}
          style={float ? { left: float.left, top: float.top } : undefined}
          role="toolbar"
          aria-label="Auszeichnen"
          onMouseDown={(ev) => (ev.target as Element).closest('button') && ev.preventDefault()}
        >
          {linkAsk !== null ? (
            linkForm
          ) : (
            <>
              {tools}
              <button type="button" className="btn" onClick={togglePin} title="Als feste Leiste über dem Text anheften">
                📌
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
