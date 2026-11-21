'use client';
/**
 * Ein Abschnitt der Ausarbeitung als Karte (Wunsch Jo, 21. November 2026): nur die Überschrift aus der Gliederung,
 * keine eigene Leiste. Geschrieben wird links, Randnotizen, Bemerkungen und Bildunterschriften stehen schon beim
 * Schreiben rechts am Rand, so wie später auf der Seite. Werkzeuge erscheinen über der Markierung; im Rand der Karte, in
 * der gerade geschrieben wird, stehen die Bausteine zum Einsetzen an der Schreibmarke.
 *
 * Gespeichert wird Markdown wie bei den Lernseiten (lib/tufte.ts) mit dem Stand `rev`: Wer gleichzeitig mit einem
 * älteren Stand speichert, überschreibt nicht unbemerkt; der andere Text bleibt als frühere Fassung erhalten.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RichText, type EditorApi } from './RichText';
import { editToTufte, glossHtml, imageHtml, noteHtml, tufteToEdit } from '@/lib/tufteEdit';
import { API_URL, BASE_PATH, ApiError, get, post } from '@/lib/api';
import w from './writecard.module.css';

export interface WriteDoc {
  id: number;
  sectionId: string;
  sectionTitle: string;
  title: string;
  ownerId: number | null;
  doneAt: number | null;
  body: string | null;
  rev: number;
  textBy: number | null;
  textAt: number | null;
  office: boolean;
}

type Atom = { el: HTMLElement; api: EditorApi; kind: 'note' | 'margin' | 'gloss' | 'img'; text: string; extra: string; full: boolean };

/** Bild verkleinern (längste Seite 1600 px) und als data:-Adresse zurückgeben (wie bei den Lernseiten). */
async function shrink(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putText(id: number, body: string, rev: number, keepalive = false): Promise<{ ok: true; rev: number } | { ok: false; status: number; error: string; body?: string; rev?: number; by?: number | null }> {
  const res = await fetch(`${API_URL}${BASE_PATH}/api/documents/${id}/text`, {
    method: 'PUT',
    credentials: 'include',
    keepalive: keepalive && body.length < 60_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body, rev }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, rev: Number(json.rev) };
  return { ok: false, status: res.status, error: typeof json.error === 'string' ? json.error : `Fehler ${res.status}`, body: json.body as string | undefined, rev: json.rev as number | undefined, by: json.by as number | null | undefined };
}

/** Markierten Text in ein Element setzen (Hervorheben, Begriff); ist schon eines drumherum, wird es aufgelöst */
function wrapSelection(box: HTMLElement | null, make: () => HTMLElement, sameAs: string): HTMLElement | null {
  const sel = getSelection();
  if (!box || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer)) return null;
  const anc = range.commonAncestorContainer;
  const inside = (anc instanceof Element ? anc : anc.parentElement)?.closest(sameAs);
  if (inside && box.contains(inside)) {
    inside.replaceWith(...inside.childNodes);
    return null;
  }
  if (range.collapsed) return null;
  const el = make();
  el.appendChild(range.extractContents());
  range.insertNode(el);
  sel.removeAllRanges();
  const after = document.createRange();
  after.setStartAfter(el);
  after.collapse(true);
  sel.addRange(after);
  return el;
}

export function WriteCard({
  doc,
  meId,
  canEdit,
  owner,
  writer,
  remote,
  mayFinish,
  mayReopen,
  onFinish,
  onReopen,
  onBody,
  onOffice,
  show,
}: {
  doc: WriteDoc;
  meId: number;
  canEdit: boolean;
  owner: string | null;
  /** Name, wer zuletzt geschrieben hat */
  writer: (uid: number | null) => string | null;
  /** neuer Stand von jemand anderem (aus dem Socket) */
  remote: { rev: number; by: number } | undefined;
  mayFinish: boolean;
  mayReopen: boolean;
  onFinish: () => void;
  onReopen: () => void;
  onBody: (id: number, body: string) => void;
  onOffice: () => void;
  show: (msg: string) => void;
}) {
  const [body, setBody] = useState(doc.body ?? '');
  const [state, setState] = useState<'' | 'dirty' | 'saving' | 'saved' | 'error'>('');
  const [focused, setFocused] = useState(false);
  const [atom, setAtom] = useState<Atom | null>(null);
  const [menu, setMenu] = useState(false);
  const [revs, setRevs] = useState<{ id: number; at: number; by: number | null; reason: string; length: number }[] | null>(null);
  const [peek, setPeek] = useState<{ id: number; body: string } | null>(null);
  const rev = useRef(doc.rev);
  const latest = useRef(body);
  const savedBody = useRef(doc.body ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const apiRef = useRef<EditorApi | null>(null);
  const card = useRef<HTMLElement>(null);
  const showRef = useRef(show);
  showRef.current = show;

  const save = useCallback(
    async (keepalive = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (busy.current || latest.current === savedBody.current) return;
      busy.current = true;
      setState('saving');
      const text = latest.current;
      try {
        let r = await putText(doc.id, text, rev.current, keepalive);
        if (!r.ok && r.status === 409 && typeof r.rev === 'number') {
          // gleichzeitig geschrieben: der eigene Text gilt, der andere bleibt als frühere Fassung im Verlauf
          rev.current = r.rev;
          if (r.body !== text) {
            showRef.current(`${writer(r.by ?? null) ?? 'Jemand'} hatte gleichzeitig in „${doc.title}“ geschrieben. Dein Text gilt; der andere steht unter „Frühere Fassungen“.`);
            r = await putText(doc.id, text, rev.current, keepalive);
          } else r = { ok: true, rev: r.rev };
        }
        if (!r.ok) throw new Error(r.error);
        rev.current = r.rev;
        savedBody.current = text;
        setState(latest.current === text ? 'saved' : 'dirty');
      } catch (e) {
        setState('error');
        showRef.current('Nicht gespeichert: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        busy.current = false;
        if (latest.current !== savedBody.current) timer.current = setTimeout(() => void save(), 1200);
      }
    },
    [doc.id, doc.title, writer],
  );

  function change(md: string) {
    latest.current = md;
    setBody(md);
    onBody(doc.id, md);
    setState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1200);
  }

  // beim Verlassen der Seite noch sichern
  useEffect(() => {
    const flush = () => {
      if (latest.current !== savedBody.current) void save(true);
    };
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  // neuer Stand von anderen: übernehmen, solange hier nichts Ungespeichertes liegt
  useEffect(() => {
    if (!remote || remote.by === meId || remote.rev <= rev.current) return;
    if (latest.current !== savedBody.current) return;
    get<{ body: string; rev: number }>(`/api/documents/${doc.id}/text`).then((r) => {
      if (latest.current !== savedBody.current || r.rev <= rev.current) return;
      rev.current = r.rev;
      savedBody.current = latest.current = r.body;
      setBody(r.body);
      onBody(doc.id, r.body);
    }, () => {});
  }, [remote, meId, doc.id, onBody]);

  // Stand vom Server, wenn der Abschnitt neu geladen wurde (z. B. nach „Zurück“)
  useEffect(() => {
    if (doc.rev > rev.current && latest.current === savedBody.current) {
      rev.current = doc.rev;
      savedBody.current = latest.current = doc.body ?? '';
      setBody(doc.body ?? '');
    }
  }, [doc.rev, doc.body]);

  const box = () => card.current?.querySelector('[role="textbox"]') as HTMLElement | null;

  function openAtom(el: HTMLElement, api: EditorApi) {
    if (!canEdit) return;
    if (el.classList.contains('ed-note')) setAtom({ el, api, kind: el.dataset.kind === 'margin' ? 'margin' : 'note', text: el.dataset.text ?? '', extra: '', full: false });
    else if (el.classList.contains('ed-gloss')) setAtom({ el, api, kind: 'gloss', text: el.textContent ?? '', extra: el.dataset.explain ?? '', full: false });
    else if (el.classList.contains('ed-img')) setAtom({ el, api, kind: 'img', text: el.dataset.cap ?? '', extra: '', full: !!el.dataset.full });
  }
  function saveAtom(remove = false) {
    if (!atom) return;
    const { el, api, kind, text, extra, full } = atom;
    const tpl = document.createElement('template');
    if (remove) {
      // Begriff entfernen lässt das Wort stehen
      if (kind === 'gloss') el.replaceWith(document.createTextNode(el.textContent ?? ''));
      else el.remove();
    } else if (kind === 'note' || kind === 'margin') tpl.innerHTML = noteHtml(kind, text.trim() || '…');
    else if (kind === 'gloss') tpl.innerHTML = glossHtml(text.trim(), extra.trim());
    else tpl.innerHTML = imageHtml(el.dataset.src ?? '', text.trim(), full);
    if (!remove && tpl.content.firstChild) el.replaceWith(tpl.content.firstChild);
    api.emit();
    setAtom(null);
  }

  /** Abbrechen: ein eben eingesetzter, noch leerer Baustein verschwindet wieder */
  function cancelAtom() {
    if (atom && (atom.kind === 'note' || atom.kind === 'margin') && !atom.el.dataset.text) {
      atom.el.remove();
      atom.api.emit();
    }
    setAtom(null);
  }

  /** neuen Baustein an der Schreibmarke einsetzen und gleich zum Ausfüllen öffnen */
  function insertNote(kind: 'note' | 'margin') {
    const api = apiRef.current;
    if (!api) return;
    api.insertHtml(noteHtml(kind, ''));
    const el = [...(box()?.querySelectorAll<HTMLElement>(`.ed-note.ed-${kind}`) ?? [])].find((x) => !x.dataset.text);
    if (el) setAtom({ el, api, kind, text: '', extra: '', full: false });
  }
  function highlight() {
    const api = apiRef.current;
    wrapSelection(box(), () => document.createElement('mark'), 'mark');
    api?.emit();
  }
  function term() {
    const api = apiRef.current;
    if (!api) return;
    const el = wrapSelection(
      box(),
      () => {
        const s = document.createElement('span');
        s.className = 'ed-gloss';
        s.dataset.explain = '';
        s.title = 'Begriff, antippen zum Ändern';
        return s;
      },
      '.ed-gloss',
    );
    api.emit();
    if (el) setAtom({ el, api, kind: 'gloss', text: el.textContent ?? '', extra: '', full: false });
    else if (!api.selectedText()) show('Erst das Wort markieren, das in die Begriffe soll.');
  }
  async function image(f: File) {
    const api = apiRef.current;
    if (!api) return;
    api.insertHtml(imageHtml(await shrink(f), '', false), true);
  }

  async function openRevs() {
    setMenu(false);
    try {
      setRevs((await get<{ revisions: NonNullable<typeof revs> }>(`/api/documents/${doc.id}/fassungen`)).revisions);
    } catch (e) {
      show(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function restore(revId: number) {
    await save();
    try {
      const r = await post<{ rev: number }>(`/api/documents/${doc.id}/fassungen/${revId}/zurueck`);
      const t = await get<{ body: string; rev: number }>(`/api/documents/${doc.id}/text`);
      rev.current = Math.max(r.rev, t.rev);
      savedBody.current = latest.current = t.body;
      setBody(t.body);
      onBody(doc.id, t.body);
      setRevs(null);
      setPeek(null);
      show('Frühere Fassung wiederhergestellt. Der Stand davor liegt nun selbst unter „Frühere Fassungen“.');
    } catch (e) {
      show(e instanceof ApiError ? e.message : String(e));
    }
  }

  const keep = (ev: React.MouseEvent) => ev.preventDefault();
  const tools = (api: EditorApi) => {
    apiRef.current = api;
    return (
      <>
        <button type="button" className="btn" onClick={highlight} title="Hervorheben wie mit dem Textmarker">
          <span className={w.markIcon}>Hervorheben</span>
        </button>
        <button type="button" className="btn" onClick={() => insertNote('note')} title="Nummerierte Randnotiz zur Stelle">
          Randnotiz
        </button>
        <button type="button" className="btn" onClick={term} title="Markiertes Wort in die Begriffe (Glossar) aufnehmen">
          Begriff
        </button>
      </>
    );
  };

  const when = doc.textAt || state === 'saved' ? new Date(doc.textAt ?? Date.now()) : null;
  const status =
    state === 'saving' ? 'speichert …' : state === 'dirty' ? 'ungespeichert' : state === 'error' ? 'nicht gespeichert' : state === 'saved' ? 'gespeichert' : when && writer(doc.textBy) ? `zuletzt ${writer(doc.textBy)}` : '';

  return (
    <article ref={card} className={`${w.card} ${doc.doneAt ? w.done : ''} ${focused ? w.focus : ''}`} data-doc={doc.id}>
      <header className={w.head}>
        <h3 className={w.title}>{doc.title}</h3>
        <div className={w.meta}>
          {doc.doneAt ? <span className={w.doneChip}>✓ fertig</span> : owner && <span>{owner}</span>}
          {status && <span className={`${w.state} ${state === 'error' ? w.err : ''}`}>{status}</span>}
          <span className={w.menuWrap}>
            <button className={`btn icon ${w.more}`} onClick={() => setMenu(!menu)} aria-label="Weitere Aktionen" aria-expanded={menu} title="Weitere Aktionen">
              ⋯
            </button>
            {menu && (
              <div className={`panel ${w.menu}`} onMouseLeave={() => setMenu(false)}>
                <button className="btn" onClick={openRevs}>
                  Frühere Fassungen
                </button>
                {doc.office && (
                  <button className="btn" onClick={() => (setMenu(false), onOffice())}>
                    Text aus dem früheren Editor
                  </button>
                )}
                {mayFinish && (
                  <button className="btn" onClick={() => (setMenu(false), void save().then(onFinish))}>
                    Fertig melden
                  </button>
                )}
                {mayReopen && (
                  <button className="btn" onClick={() => (setMenu(false), onReopen())}>
                    Wieder öffnen
                  </button>
                )}
              </div>
            )}
          </span>
        </div>
      </header>
      {doc.office && !body && (
        <p className={w.office}>
          Hier liegt noch Text aus dem früheren Office-Editor.{' '}
          <button className="btn" onClick={onOffice}>
            Ansehen und übernehmen
          </button>
        </p>
      )}
      <div className={w.write} onFocusCapture={() => setFocused(true)} onBlurCapture={() => setFocused(false)}>
        {canEdit ? (
          <RichText
            value={body}
            onChange={change}
            max={4_000_000}
            label={`Text: ${doc.title}`}
            render={tufteToEdit}
            serialize={editToTufte}
            tools={['bold', 'italic', 'heading', 'ul', 'quote', 'link']}
            headingTag="h3"
            extraTools={tools}
            pinKey="collegare-editor-leiste-ausarbeitung"
            onAtom={openAtom}
            tip={false}
            placeholder="Hier schreiben …"
          />
        ) : (
          <div className={w.readonly} dangerouslySetInnerHTML={{ __html: tufteToEdit(body) || '<p class="muted">Noch kein Text.</p>' }} />
        )}
      </div>
      {canEdit && focused && !atom && (
        <div className={w.insert} onMouseDown={keep} role="toolbar" aria-label="Am Rand einsetzen">
          <button type="button" className="btn" onClick={() => insertNote('note')} title="Nummerierte Randnotiz an der Schreibmarke">
            + Randnotiz
          </button>
          <button type="button" className="btn" onClick={() => insertNote('margin')} title="Bemerkung am Rand ohne Nummer">
            + Bemerkung
          </button>
          <label className="btn" title="Bild einsetzen, Unterschrift steht am Rand">
            + Bild
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void image(f);
              }}
            />
          </label>
        </div>
      )}
      {atom && (
        <form
          className={`panel ${w.atom}`}
          style={{ top: Math.max(40, atom.el.getBoundingClientRect().top - (card.current?.getBoundingClientRect().top ?? 0) - 6) }}
          onSubmit={(e) => {
            e.preventDefault();
            saveAtom();
          }}
        >
          <strong>{atom.kind === 'note' ? 'Randnotiz' : atom.kind === 'margin' ? 'Bemerkung am Rand' : atom.kind === 'gloss' ? 'Begriff' : 'Bild'}</strong>
          {atom.kind === 'gloss' && <input value={atom.text} onChange={(e) => setAtom({ ...atom, text: e.target.value })} aria-label="Wort" placeholder="Wort" />}
          <textarea
            autoFocus
            rows={3}
            value={atom.kind === 'gloss' ? atom.extra : atom.text}
            onChange={(e) => setAtom(atom.kind === 'gloss' ? { ...atom, extra: e.target.value } : { ...atom, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelAtom();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveAtom();
            }}
            placeholder={atom.kind === 'img' ? 'Bildunterschrift (steht am Rand)' : atom.kind === 'gloss' ? 'Erklärung für die Begriffe' : 'Text am Rand'}
            aria-label="Inhalt"
          />
          {atom.kind === 'img' && (
            <label className={w.check}>
              <input type="checkbox" checked={atom.full} onChange={(e) => setAtom({ ...atom, full: e.target.checked })} /> über die ganze Breite
            </label>
          )}
          <div className="row">
            <button type="button" className="btn danger" onClick={() => saveAtom(true)}>
              Entfernen
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={cancelAtom}>
              Abbrechen
            </button>
            <button type="submit" className="btn primary">
              Übernehmen
            </button>
          </div>
        </form>
      )}
      {revs && (
        <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && (setRevs(null), setPeek(null))}>
          <div className={`modal ${w.revModal}`} role="dialog" aria-label="Frühere Fassungen">
            <h2>Frühere Fassungen: {doc.title}</h2>
            <div className={w.revBody}>
              <ul className={w.revList}>
                {revs.length === 0 && <li className="muted">Noch keine früheren Fassungen.</li>}
                {revs.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`btn ${peek?.id === r.id ? 'on' : ''}`}
                      onClick={async () => setPeek({ id: r.id, body: (await get<{ body: string }>(`/api/documents/${doc.id}/fassungen/${r.id}`)).body })}
                    >
                      {new Date(r.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                      <span className="muted">
                        {' '}
                        · {writer(r.by) ?? 'jemand'}
                        {r.reason === 'mark' ? ' · vor Abgleich' : r.reason === 'undo' ? ' · vor Wiederherstellen' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className={w.revPeek}>{peek ? <div dangerouslySetInnerHTML={{ __html: tufteToEdit(peek.body) }} /> : <p className="muted">Fassung links auswählen.</p>}</div>
            </div>
            <div className="row">
              <span className="grow" />
              <button className="btn" onClick={() => (setRevs(null), setPeek(null))}>
                Schließen
              </button>
              {peek && canEdit && (
                <button className="btn primary" onClick={() => restore(peek.id)}>
                  Diese Fassung wiederherstellen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
