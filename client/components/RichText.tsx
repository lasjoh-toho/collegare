'use client';
/**
 * Textfeld „wie in Word“ (Wunsch Jo, 14. November 2026): fett, kursiv, Listen und Links erscheinen gleich so, wie
 * sie später zu sehen sind. Die Werkzeuge stehen als feste Leiste über dem Text oder schweben über der Markierung;
 * beides lässt sich umschalten (📌). Gespeichert wird weiter Markdown: für Karten lib/markdown.ts, für Lernseiten
 * lib/tufte.ts (über render/serialize).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { htmlToMarkdown, renderMarkdown } from '@/lib/markdown';
import r from './richtext.module.css';

export type Cmd = 'bold' | 'italic' | 'heading' | 'ul' | 'ol' | 'quote' | 'link' | 'source';

/** Für zusätzliche Werkzeuge und Bausteine der Seite, die den Editor einbettet */
export interface EditorApi {
  /** HTML hinter der (gemerkten) Markierung einsetzen; block = als eigener Absatz nach dem aktuellen */
  insertHtml: (html: string, block?: boolean) => void;
  /** markierter Text (leer, wenn nichts markiert) */
  selectedText: () => string;
  /** nach eigener Änderung am Inhalt: Markdown neu erzeugen */
  emit: () => void;
}

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);
const LABEL: Record<Cmd, [ReactNode, string]> = {
  bold: [<b key="b">F</b>, 'Fett (Strg+B)'],
  italic: [<i key="i">K</i>, 'Kursiv (Strg+I)'],
  heading: ['Überschrift', 'Zwischenüberschrift'],
  ul: ['• Liste', 'Liste mit Punkten'],
  ol: ['1. Liste', 'Nummerierte Liste'],
  quote: ['Zitat', 'Zitat; eine Zeile „— Name“ darin nennt die Quelle'],
  link: ['Link', 'Link setzen'],
  source: ['Quelle', 'Zeile „Quelle:“ anfügen'],
};

export function RichText({
  value,
  onChange,
  onPaste,
  max = 5000,
  label,
  render = renderMarkdown,
  serialize = htmlToMarkdown,
  tools = ['bold', 'italic', 'heading', 'ul', 'ol', 'link', 'source'],
  extraTools,
  headingTag = 'h3',
  pinKey = 'collegare-editor-leiste',
  defaultPinned = false,
  onAtom,
  placeholder = 'Schreib hier. Markiere Text, um ihn fett, kursiv oder als Liste zu setzen.',
  className = '',
}: {
  value: string;
  onChange: (md: string) => void;
  /** Regeln zum Einsetzen (CardEditor); ein preventDefault dort weist das Einsetzen ab */
  onPaste?: (ev: ClipboardEvent<HTMLDivElement>) => void;
  max?: number;
  label: string;
  render?: (md: string) => string;
  serialize?: (root: Node) => string;
  tools?: Cmd[];
  extraTools?: (api: EditorApi) => ReactNode;
  headingTag?: 'h2' | 'h3';
  /** Merkt sich je Einsatzort, ob die Leiste fest steht */
  pinKey?: string;
  defaultPinned?: boolean;
  /** Antippen eines Bausteins (Randnotiz, Bild, Worterklärung …) */
  onAtom?: (el: HTMLElement, api: EditorApi) => void;
  placeholder?: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [pinned, setPinned] = useState(defaultPinned);
  const [float, setFloat] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [linkAsk, setLinkAsk] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [tooLong, setTooLong] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(pinKey);
      if (v !== null) setPinned(v === '1');
    } catch {
      /* ohne Speicher: Voreinstellung */
    }
  }, [pinKey]);

  // Wert von außen (erstes Öffnen, Word-Übernahme, „Zuschreibung anfügen“ …) in das Feld übernehmen
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || value === emitted.current) return;
    const first = emitted.current === null;
    el.innerHTML = render(value);
    emitted.current = value;
    if (!first) caretToEnd(el);
  }, [value, render]);

  function emit() {
    const el = box.current;
    if (!el) return;
    const md = serialize(el);
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

  // Werkzeuge über der Markierung mitführen
  useEffect(() => {
    const onSel = () => {
      const el = box.current;
      const sel = getSelection();
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
        if (linkAsk === null) setFloat(null);
        return;
      }
      saved.current = sel.getRangeAt(0).cloneRange();
      setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), ul: document.queryCommandState('insertUnorderedList'), ol: document.queryCommandState('insertOrderedList') });
      if (sel.isCollapsed) {
        if (linkAsk === null) setFloat(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      // am Handy liegt das Menü des Systems über der Markierung, unseres darunter
      const below = matchMedia('(pointer: coarse)').matches || rect.top < 110;
      const left = Math.min(Math.max(rect.left + rect.width / 2, 170), innerWidth - 170);
      setFloat({ left, top: below ? rect.bottom + 8 : rect.top - 8, below });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [linkAsk]);

  function restore() {
    const el = box.current;
    if (!el) return;
    el.focus();
    const sel = getSelection();
    if (saved.current && el.contains(saved.current.startContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(saved.current);
    } else caretToEnd(el);
  }

  const api: EditorApi = {
    insertHtml: (html, block = false) => {
      const el = box.current;
      if (!el) return;
      restore();
      const sel = getSelection();
      const range = sel?.rangeCount ? sel.getRangeAt(0) : document.createRange();
      if (!el.contains(range.startContainer)) {
        range.selectNodeContents(el);
      }
      // Markiertes bleibt stehen, der Baustein kommt dahinter
      range.collapse(false);
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const last = tpl.content.lastChild;
      if (!last) return;
      if (block) {
        let top: Node | null = range.startContainer;
        while (top && top.parentNode !== el) top = top.parentNode;
        if (top) el.insertBefore(tpl.content, top.nextSibling);
        else el.appendChild(tpl.content);
        if (!last.nextSibling) el.appendChild(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
      } else range.insertNode(tpl.content);
      const after = document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
      emit();
    },
    selectedText: () => (saved.current && !saved.current.collapsed ? saved.current.toString() : ''),
    emit,
  };

  function blockOf(): HTMLElement | null {
    const n = getSelection()?.anchorNode ?? null;
    const el = n instanceof HTMLElement ? n : (n?.parentElement ?? null);
    return el?.closest('h2,h3,h4,blockquote,p,div,li') as HTMLElement | null;
  }

  function run(cmd: Cmd) {
    const el = box.current;
    if (!el) return;
    if (document.activeElement !== el) restore();
    exec('defaultParagraphSeparator', 'p');
    if (cmd === 'bold' || cmd === 'italic') exec(cmd);
    else if (cmd === 'ul') exec('insertUnorderedList');
    else if (cmd === 'ol') exec('insertOrderedList');
    else if (cmd === 'heading') exec('formatBlock', /^H[2-4]$/.test(blockOf()?.tagName ?? '') ? 'p' : headingTag);
    else if (cmd === 'quote') exec('formatBlock', blockOf()?.closest('blockquote') ? 'p' : 'blockquote');
    else if (cmd === 'link') {
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
    if (/^https?:\/\/\S+\.\S+/.test(url)) {
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
    setFloat(null);
    try {
      localStorage.setItem(pinKey, v ? '1' : '0');
    } catch {
      /* egal */
    }
  }

  const buttons = (
    <>
      {tools.map((c) => (
        <button key={c} type="button" className={`btn ${active[c] ? 'on' : ''}`} onClick={() => run(c)} title={LABEL[c][1]} aria-pressed={c in active ? !!active[c] : undefined}>
          {LABEL[c][0]}
        </button>
      ))}
      {extraTools?.(api)}
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
  // Knöpfe nehmen der Markierung nicht den Fokus
  const keepFocus = (ev: React.MouseEvent) => (ev.target as Element).closest('button, label.btn') && ev.preventDefault();

  return (
    <div className={`${r.wrap} ${className}`}>
      {pinned && (
        <div className={r.bar} role="toolbar" aria-label="Auszeichnen" onMouseDown={keepFocus}>
          {buttons}
          <span className="grow" />
          <button type="button" className="btn on" onClick={togglePin} title="Leiste lösen: Werkzeuge erscheinen dann über markiertem Text">
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
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={paste}
        onFocus={() => exec('defaultParagraphSeparator', 'p')}
        onClick={(ev) => {
          const atom = (ev.target as HTMLElement).closest('[contenteditable="false"], .ed-gloss') as HTMLElement | null;
          if (atom && box.current?.contains(atom) && onAtom) onAtom(atom, api);
        }}
      />
      {tooLong && <div className={r.long}>Der Text ist länger als {max} Zeichen; das Ende wird nicht gespeichert.</div>}
      {!pinned && (float || linkAsk !== null) && (
        <div className={`${r.float} ${float?.below ? r.below : ''}`} style={float ? { left: float.left, top: float.top } : undefined} role="toolbar" aria-label="Auszeichnen" onMouseDown={keepFocus}>
          {linkAsk !== null ? (
            linkForm
          ) : (
            <>
              {buttons}
              <button type="button" className="btn" onClick={togglePin} title="Als feste Leiste über dem Text anheften">
                📌
              </button>
            </>
          )}
        </div>
      )}
      {!pinned && !float && linkAsk === null && <div className={r.tip}>Text markieren, dann erscheinen die Werkzeuge darüber. 📌 heftet sie als Leiste an.</div>}
    </div>
  );
}
