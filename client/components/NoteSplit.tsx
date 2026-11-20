'use client';
/**
 * „Auf Notizen verteilen“ (Wunsch Jo, 20. November 2026, nach „Auf Seiten verteilen“ in mod_bento): Ein Stück einer
 * Webseite mit Bildern und Text wird eingefügt oder hergezogen. Hier wird es eine oder mehrere Notizen; die
 * Bildunterschrift kann Titel werden, die Ursprungsseite steht bei jeder Notiz. Liest der Server die Seite, kommen
 * Seitentitel, Autor und Lizenz dazu.
 *
 * Browser geben beim Kopieren die Adresse der Seite nicht mit. Wir nehmen den Link um ein Bild, sonst fragt das Feld
 * „Ursprungsseite“ danach.
 */
import { useEffect, useMemo, useState } from 'react';
import { imageInfo, proxied, readPage, uploadImage } from '@/lib/imageDrop';
import { plan, type Block, type PlannedNote, type SplitMode } from '@/lib/splitPaste';
import c from './imageimport.module.css';
import n from './notes.module.css';

export interface SplitNoteInput {
  kind: 'image' | 'source';
  title: string;
  body: string;
  source: string;
  url: string;
  credit: string;
  license: string;
  origin: string;
  file?: string;
}

const MODES: { m: SplitMode; label: string; hint: string }[] = [
  { m: 'one', label: 'Eine Notiz', hint: 'Aller Text in eine Notiz, das erste Bild dazu; weitere Bilder werden eigene Notizen.' },
  { m: 'sections', label: 'Je Abschnitt', hint: 'Neue Notiz an jeder Überschrift und jedem Bild.' },
  { m: 'each', label: 'Je Absatz', hint: 'Jeder Absatz und jedes Bild wird eine eigene Notiz.' },
];

export function NoteSplit({
  projectId,
  scope,
  blocks,
  limit,
  addNote,
  logPaste,
  onClose,
  onDone,
}: {
  projectId: number;
  scope: string;
  blocks: Block[];
  /** höchstens so viele Zeichen Text von außen je Notiz (Einstellung „Nicht mehr einsetzen lassen“), sonst null */
  limit: number | null;
  addNote: (x: SplitNoteInput) => Promise<{ ok: boolean; id?: number; error?: string }>;
  /** Text von außen ins Protokoll „Arbeitsprozess“ */
  logPaste: (text: string, noteId: number, title: string) => void;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const multi = blocks.length > 1;
  const [mode, setMode] = useState<SplitMode>(blocks.some((b) => b.type === 'img') && blocks.some((b) => b.type !== 'img') ? 'sections' : 'one');
  const [capTitle, setCapTitle] = useState(true);
  const firstPage = blocks.find((b): b is Extract<Block, { type: 'img' }> => b.type === 'img' && !!b.page)?.page ?? '';
  const [origin, setOrigin] = useState(firstPage);
  const [page, setPage] = useState<{ title: string; author: string; license: string } | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const notes = useMemo(() => plan(blocks, mode, capTitle), [blocks, mode, capTitle]);
  useEffect(() => setSkip(new Set()), [mode, capTitle]);

  async function readOrigin() {
    if (!/^https?:\/\//i.test(origin.trim())) return;
    try {
      const p = await readPage(origin.trim());
      setPage({ title: p.title, author: p.author, license: p.license });
    } catch {
      setPage(null);
    }
  }

  const tooLong = (x: PlannedNote) => limit !== null && [...x.body].length >= limit;

  async function take() {
    const list = notes.filter((x, i) => !skip.has(i) && !tooLong(x));
    if (!list.length) return;
    const o = /^https?:\/\//i.test(origin.trim()) ? origin.trim() : '';
    let added = 0;
    let firstError: string | null = null;
    for (const [i, x] of list.entries()) {
      setBusy(list.length > 1 ? `Notiz ${i + 1} von ${list.length} …` : 'Wird übernommen …');
      try {
        let input: SplitNoteInput;
        if (x.img) {
          const info = !x.img.file ? await imageInfo(x.img.src, x.img.page ?? (o || null)).catch(() => null) : null;
          const up = await uploadImage(projectId, scope, x.img.file ? { file: x.img.file } : { url: info?.imageUrl ?? x.img.src });
          input = {
            kind: 'image',
            title: (x.title || (capTitle ? info?.title : '') || '').slice(0, 200),
            body: x.body.slice(0, 10_000),
            source: '',
            url: x.img.file ? '' : x.img.src,
            credit: (info?.credit || page?.author || '').slice(0, 300),
            license: (info?.license || page?.license || '').slice(0, 200),
            origin: info?.origin ?? x.img.page ?? o,
            file: up.file,
          };
        } else {
          input = { kind: 'source', title: x.title.slice(0, 200), body: x.body.slice(0, 10_000), source: page?.title ? [page.author, page.title].filter(Boolean).join(': ').slice(0, 500) : '', url: o, credit: '', license: '', origin: '' };
        }
        const r = await addNote(input);
        if (!r.ok) {
          firstError ??= r.error ?? 'Speichern fehlgeschlagen';
          continue;
        }
        added++;
        if (r.id && x.body.trim()) logPaste(x.body, r.id, x.title || page?.title || '');
      } catch (e) {
        firstError ??= e instanceof Error ? e.message : String(e);
      }
    }
    setBusy('');
    if (!added) return setError(firstError ?? 'Nichts übernommen');
    onDone(`${added === 1 ? 'Eine Notiz' : `${added} Notizen`} angelegt${firstError ? ` (${firstError})` : ''}.${o ? '' : ' Trag bei Bedarf die Ursprungsseite nach.'}`);
    onClose();
  }

  const count = notes.filter((x, i) => !skip.has(i) && !tooLong(x)).length;
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal ${c.modal}`} role="dialog" aria-label="Auf Notizen verteilen">
        <h2>Auf Notizen verteilen</h2>
        {multi && (
          <div className={n.row}>
            <span className="seg" role="group" aria-label="Wie verteilen?">
              {MODES.map((x) => (
                <button key={x.m} type="button" className={`btn ${mode === x.m ? 'on' : ''}`} aria-pressed={mode === x.m} title={x.hint} onClick={() => setMode(x.m)}>
                  {x.label}
                </button>
              ))}
            </span>
            {blocks.some((b) => b.type === 'img' && b.caption) && (
              <label className={n.row}>
                <input type="checkbox" checked={capTitle} onChange={(e) => setCapTitle(e.target.checked)} /> Bildunterschrift als Überschrift
              </label>
            )}
          </div>
        )}
        <div className={c.form}>
          <input type="url" value={origin} onChange={(e) => setOrigin(e.target.value)} onBlur={() => void readOrigin()} placeholder="Ursprungsseite: Adresse der Seite, von der das stammt (https://…)" aria-label="Ursprungsseite" />
        </div>
        <p className={`muted ${c.meta}`}>
          {page ? `Seite: ${[page.title, page.author, page.license].filter(Boolean).join(' · ')}` : 'Die Seite steht dann bei jeder Notiz. Browser geben sie beim Kopieren nicht mit: Adresse im anderen Tab kopieren und hier einfügen.'}
        </p>
        <div className={`${c.grid} ${n.splitList}`}>
          {notes.map((x, i) => (
            <label key={i} className={`${c.pick} ${!skip.has(i) && !tooLong(x) ? c.on : ''}`}>
              <input
                type="checkbox"
                checked={!skip.has(i) && !tooLong(x)}
                disabled={tooLong(x)}
                onChange={() =>
                  setSkip((s) => {
                    const t = new Set(s);
                    if (t.has(i)) t.delete(i);
                    else t.add(i);
                    return t;
                  })
                }
              />
              {x.img && <img src={x.img.file ? x.img.src : proxied(x.img.src)} alt="" />}
              {x.title && <strong>{x.title}</strong>}
              {x.body && <span className={c.cap}>{x.body}</span>}
              {tooLong(x) && <span className="error">Mehr als {limit! - 1} Zeichen von außen: so nicht erlaubt.</span>}
            </label>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="muted">{busy || 'Eingefügter Text steht danach unter „Arbeitsprozess“.'}</span>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose} disabled={!!busy}>
            Abbrechen
          </button>
          <button type="button" className="btn primary" onClick={() => void take()} disabled={!!busy || !count}>
            {count === 1 ? 'Eine Notiz anlegen' : `${count} Notizen anlegen`}
          </button>
        </div>
      </div>
    </div>
  );
}
