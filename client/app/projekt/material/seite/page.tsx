'use client';
/**
 * Lernseite (Material, Art „page“): Lernende lesen im Tufte-Stil, Lehrkräfte schreiben „wie in Word“ (Werkzeuge über
 * der Markierung, anheftbar) mit Vorschau daneben; Markdown nur über den Knopf „Markdown“ für Profis.
 * Word-Dateien lassen sich übernehmen (mammoth im Browser, nichts verlässt das Gerät); Bilder werden verkleinert
 * und in die Seite eingebettet.
 */
import { useEffect, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { RichText, type EditorApi } from '@/components/RichText';
import { TufteView } from '@/components/TufteView';
import { editToTufte, glossHtml, imageHtml, noteHtml, tufteToEdit, videoHtml } from '@/lib/tufteEdit';
import { videoEmbed } from '@/lib/tufte';
import { ApiError, get, href, patch } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import st from './seite.module.css';

interface Page {
  id: number;
  title: string;
  note: string;
  body: string;
}

/** Bild verkleinern (längste Seite 1600 px) und als data:-Adresse zurückgeben. */
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

/** Word-Datei → Markdown der Lernseite (Fußnoten werden Seitennotizen). */
async function fromDocx(file: File): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const shrinkImages = mammoth.images.imgElement(async (image) => {
    const b64 = await image.read('base64');
    const blob = await (await fetch(`data:${image.contentType};base64,${b64}`)).blob();
    return { src: await shrink(blob) };
  });
  const r = await (mammoth as unknown as { convertToMarkdown: typeof mammoth.convertToHtml }).convertToMarkdown({ arrayBuffer: await file.arrayBuffer() }, { convertImage: shrinkImages });
  let md = r.value;
  // Fußnoten aus Word: Text am Ende einsammeln, Verweis im Text durch ^[…] ersetzen
  const notes = new Map<string, string>();
  md = md.replace(/^\d+\.\s*<a id="(footnote-\d+)"><\/a>\s*(.*?)\s*\[↑\]\(#footnote-ref-\d+\)\s*$/gm, (_m, id: string, text: string) => {
    notes.set(id, text.trim());
    return '';
  });
  md = md.replace(/<sup>\[\\?\[\d+\\?\]\]\(#(footnote-\d+)\)<\/sup>/g, (m, id: string) => (notes.has(id) ? `^[${notes.get(id)}]` : m));
  md = md.replace(/<a id="[^"]*"><\/a>/g, '');
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export default function SeitePage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const mParam = useQuery('m');
  const editParam = useQuery('bearbeiten');
  const id = idParam ? Number(idParam) : NaN;
  const mid = mParam ? Number(mParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const [markdown, setMarkdown] = useState(false);
  // Baustein, der gerade geändert wird (Randnotiz, Worterklärung, Bild, Video)
  const [atom, setAtom] = useState<{ el: HTMLElement; api: EditorApi; text: string; extra: string; full: boolean } | null>(null);
  useEffect(() => {
    try {
      setMarkdown(localStorage.getItem('collegare-seite-markdown') === '1');
    } catch {
      /* WYSIWYG */
    }
  }, []);
  function toggleMarkdown() {
    setMarkdown(!markdown);
    try {
      localStorage.setItem('collegare-seite-markdown', markdown ? '0' : '1');
    } catch {
      /* egal */
    }
  }
  function openAtom(el: HTMLElement, api: EditorApi) {
    if (el.classList.contains('ed-note')) setAtom({ el, api, text: el.dataset.text ?? '', extra: '', full: false });
    else if (el.classList.contains('ed-gloss')) setAtom({ el, api, text: el.textContent ?? '', extra: el.dataset.explain ?? '', full: false });
    else if (el.classList.contains('ed-img')) setAtom({ el, api, text: el.dataset.cap ?? '', extra: '', full: !!el.dataset.full });
    else if (el.classList.contains('ed-video')) setAtom({ el, api, text: el.dataset.url ?? '', extra: '', full: false });
  }
  function saveAtom(remove = false) {
    if (!atom) return;
    const { el, api, text, extra, full } = atom;
    const tpl = document.createElement('template');
    if (remove) el.remove();
    else if (el.classList.contains('ed-note')) tpl.innerHTML = noteHtml(el.dataset.kind === 'margin' ? 'margin' : 'note', text.trim());
    else if (el.classList.contains('ed-gloss')) tpl.innerHTML = glossHtml(text.trim(), extra.trim());
    else if (el.classList.contains('ed-img')) tpl.innerHTML = imageHtml(el.dataset.src ?? '', text.trim(), full);
    else if (el.classList.contains('ed-video')) tpl.innerHTML = videoHtml(text.trim());
    if (!remove && tpl.content.firstChild) el.replaceWith(tpl.content.firstChild);
    api.emit();
    setAtom(null);
  }
  const dirty = !!page && (title !== page.title || body !== page.body);

  useEffect(() => {
    if (!Number.isInteger(id) || !Number.isInteger(mid)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setError(String(e.message ?? e)));
    get<{ page: Page; canEdit: boolean }>(`/api/projects/${id}/materials/${mid}`).then(
      (r) => {
        setPage(r.page);
        setTitle(r.page.title);
        setBody(r.page.body);
        setCanEdit(r.canEdit);
      },
      (e) => setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [id, mid]);
  useEffect(() => {
    if (editParam && canEdit) setEditing(true);
  }, [editParam, canEdit]);
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (dirty) ev.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setError('');
    try {
      await patch(`/api/projects/${id}/materials/${mid}`, { title: title.trim() || 'Ohne Titel', body });
      setPage({ ...page!, title: title.trim() || 'Ohne Titel', body });
      setMsg('Gespeichert');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  /** Text an der Schreibmarke einfügen bzw. die Auswahl umschließen */
  function wrap(before: string, after = '', placeholder = '') {
    const el = area.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const sel = body.slice(a, b) || placeholder;
    const next = body.slice(0, a) + before + sel + after + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  }
  const line = (prefix: string, placeholder: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? body.length;
    const start = body.lastIndexOf('\n', a - 1) + 1;
    const lead = start === a ? '' : '\n\n';
    wrap(lead + prefix, '', placeholder);
  };

  async function addImage(file: File) {
    const src = await shrink(file);
    const cap = prompt('Bildunterschrift (steht am Rand)', '') ?? '';
    wrap(`\n\n![${cap}](${src})\n\n`);
  }

  async function importDocx(file: File) {
    if (body.trim() && !confirm('Den bisherigen Text durch die Word-Datei ersetzen?')) return;
    try {
      setMsg('Word-Datei wird übernommen …');
      let md = await fromDocx(file);
      // erste Überschrift aus Word wird der Titel der Seite
      const h1 = /^# (.+)\n+/.exec(md);
      if (h1) md = md.slice(h1[0].length);
      setBody(md);
      if (!title.trim() || title === 'Neue Seite') setTitle(h1 ? h1[1].trim() : file.name.replace(/\.docx$/i, ''));
      setMsg('Übernommen. Bitte prüfen und speichern.');
    } catch (e) {
      setError('Word-Datei nicht lesbar: ' + (e instanceof Error ? e.message : String(e)));
      setMsg('');
    }
  }

  const extraTools = (api: EditorApi) => (
    <>
      <button type="button" className="btn" onClick={() => api.insertHtml(noteHtml('note', 'Randnotiz'))} title="Randnotiz">
        Randnotiz
      </button>
      <button type="button" className="btn" onClick={() => api.insertHtml(noteHtml('margin', 'Bemerkung'))} title="Randbemerkung ohne Nummer">
        Marginalie
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const w = api.selectedText().trim() || 'Wort';
          api.insertHtml(glossHtml(w, 'Erklärung'));
        }}
        title="Worterklärung"
      >
        Worterklärung
      </button>
      <label className="btn" title="Bild einfügen">
        Bild
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) api.insertHtml(imageHtml(await shrink(f), '', false), true);
          }}
        />
      </label>
      <button
        type="button"
        className="btn"
        onClick={() => {
          const u = prompt('Adresse des Videos (YouTube oder Vimeo)')?.trim();
          if (!u) return;
          if (!videoEmbed(u)) return setError('Nur Videos von YouTube oder Vimeo lassen sich einbetten; andere bitte als Link setzen.');
          api.insertHtml(videoHtml(u), true);
        }}
      >
        Video
      </button>
    </>
  );

  if (!me || !project) return <Topbar me={me ?? null} />;
  return (
    <ProjectShell
      me={me}
      project={project}
      where="Material"
      fill={editing}
      actions={
        <>
          <a className="btn" href={href(`/projekt/material/?id=${id}`)}>
            ← Material
          </a>
          {canEdit && (
            <button className={`btn ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Lesen' : 'Bearbeiten'}
            </button>
          )}
          {editing && (
            <button className="btn primary" disabled={!dirty} onClick={save}>
              Speichern
            </button>
          )}
        </>
      }
    >
      {error && <div className="error">{error}</div>}
      {page && !editing && (
        <div className={st.read}>
          <TufteView title={page.title} subtitle={page.note || undefined} body={page.body} />
        </div>
      )}
      {page && editing && (
        <div className={st.split}>
          <div className={st.editor}>
            <input className={st.titleIn} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel der Seite" />
            <div className={st.tools}>
              <label className="btn" title="Word-Datei übernehmen">
                Word übernehmen
                <input type="file" accept=".docx" hidden onChange={(e) => e.target.files?.[0] && void importDocx(e.target.files[0])} />
              </label>
              {msg && <span className={st.msg}>{msg}</span>}
              <span className="grow" />
              <button type="button" className={`btn ${markdown ? 'on' : ''}`} onClick={toggleMarkdown} aria-pressed={markdown} title="Markdown">
                Markdown
              </button>
            </div>
            {markdown ? (
              <>
            <div className={st.tools}>
              <button className="btn" onClick={() => line('## ', 'Abschnitt')} title="Abschnitt">
                Abschnitt
              </button>
              <button className="btn" onClick={() => wrap('**', '**', 'fett')} title="Fett">
                <b>F</b>
              </button>
              <button className="btn" onClick={() => wrap('*', '*', 'kursiv')} title="Kursiv">
                <i>K</i>
              </button>
              <button className="btn" onClick={() => wrap('^[', ']', 'Randnotiz')} title="Randnotiz">
                Randnotiz
              </button>
              <button className="btn" onClick={() => wrap('^^[', ']', 'Bemerkung')} title="Randbemerkung ohne Nummer">
                Marginalie
              </button>
              <button className="btn" onClick={() => wrap('{', '|Erklärung}', 'Wort')} title="Worterklärung">
                Worterklärung
              </button>
              <button className="btn" onClick={() => line('> ', 'Zitat')} title="Zitat">
                Zitat
              </button>
              <button className="btn" onClick={() => line('- ', 'Punkt')}>
                Liste
              </button>
              <button
                className="btn"
                onClick={() => {
                  const u = prompt('Adresse des Links');
                  if (u) wrap('[', `](${u})`, 'Linktext');
                }}
              >
                Link
              </button>
              <label className="btn">
                Bild
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void addImage(e.target.files[0])} />
              </label>
              <button
                className="btn"
                onClick={() => {
                  const u = prompt('Adresse des Videos (YouTube oder Vimeo)');
                  if (u) line(u.trim() + '\n\n', '');
                }}
              >
                Video
              </button>
            </div>
            <textarea
              ref={area}
              className={st.area}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder={'## Einstieg\n\nText mit einer Randnotiz^[Steht rechts am Rand, auf dem Handy direkt im Text.] und einer {Hyperinflation|Sehr schnelle Geldentwertung} zum Antippen.\n\n![Bildunterschrift](https://…)'}
              spellCheck
            />
              </>
            ) : (
              <div
                className={st.rich}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    void save();
                  }
                }}
              >
                <RichText
                  value={body}
                  onChange={setBody}
                  max={4_000_000}
                  label="Text der Lernseite"
                  render={tufteToEdit}
                  serialize={editToTufte}
                  tools={['heading', 'bold', 'italic', 'ul', 'ol', 'quote', 'link']}
                  headingTag="h2"
                  extraTools={extraTools}
                  pinKey="collegare-editor-leiste-seite"
                  onAtom={openAtom}
                  placeholder="Schreib hier deine Seite. Markiere Text, dann erscheinen die Werkzeuge darüber."
                />
              </div>
            )}
            {atom && (
              <form
                className={st.atom}
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAtom();
                }}
              >
                <strong>
                  {atom.el.classList.contains('ed-note')
                    ? atom.el.dataset.kind === 'margin'
                      ? 'Marginalie'
                      : 'Randnotiz'
                    : atom.el.classList.contains('ed-gloss')
                      ? 'Worterklärung'
                      : atom.el.classList.contains('ed-img')
                        ? 'Bild'
                        : 'Video'}
                </strong>
                {atom.el.classList.contains('ed-gloss') && <input value={atom.text} onChange={(e) => setAtom({ ...atom, text: e.target.value })} aria-label="Wort" placeholder="Wort" />}
                <textarea
                  autoFocus
                  rows={atom.el.classList.contains('ed-video') ? 1 : 3}
                  value={atom.el.classList.contains('ed-gloss') ? atom.extra : atom.text}
                  onChange={(e) => setAtom(atom.el.classList.contains('ed-gloss') ? { ...atom, extra: e.target.value } : { ...atom, text: e.target.value })}
                  placeholder={atom.el.classList.contains('ed-img') ? 'Bildunterschrift (steht am Rand)' : atom.el.classList.contains('ed-video') ? 'https://youtu.be/…' : atom.el.classList.contains('ed-gloss') ? 'Erklärung' : 'Text am Rand'}
                  aria-label="Inhalt"
                />
                {atom.el.classList.contains('ed-img') && (
                  <label className={st.check}>
                    <input type="checkbox" checked={atom.full} onChange={(e) => setAtom({ ...atom, full: e.target.checked })} /> über die ganze Breite
                  </label>
                )}
                <div className="row">
                  <button type="button" className="btn danger" onClick={() => saveAtom(true)}>
                    Entfernen
                  </button>
                  <span className="grow" />
                  <button type="button" className="btn" onClick={() => setAtom(null)}>
                    Abbrechen
                  </button>
                  <button type="submit" className="btn primary">
                    Übernehmen
                  </button>
                </div>
              </form>
            )}
          </div>
          <div className={st.preview}>
            <TufteView title={title || 'Ohne Titel'} body={body} />
          </div>
        </div>
      )}
    </ProjectShell>
  );
}
