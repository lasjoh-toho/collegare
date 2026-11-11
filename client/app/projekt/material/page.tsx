'use client';
/**
 * Material zum Einarbeiten (Wunsch Jo, 11. November 2026): Lehrkräfte veröffentlichen Webseiten, Videos, PDFs und
 * Dokumente; Lernende sehen sie von Anfang an, auch beim Start aus Moodle. Videos von YouTube und Vimeo werden
 * eingebettet (YouTube ohne Cookies), PDFs, Bilder und Videodateien im Browser angezeigt, Dokumente heruntergeladen.
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { API_URL, ApiError, BASE_PATH, del, get, href, patch, post } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import m from './material.module.css';

interface Material {
  id: number;
  kind: 'link' | 'video' | 'file' | 'page';
  title: string;
  url: string | null;
  note: string;
  fileName: string | null;
  mime: string | null;
  size: number | null;
}

/** Einbettbare Adresse für YouTube und Vimeo, sonst null. */
function embedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v')) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.searchParams.get('v')!)}`;
    if (host === 'youtube.com' && u.pathname.startsWith('/shorts/')) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.split('/')[2])}`;
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}`;
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video/${u.pathname.split('/')[1]}?dnt=1`;
  } catch {}
  return null;
}

const fileUrl = (projectId: number, id: number, download = false) => `${API_URL}${BASE_PATH}/api/projects/${projectId}/materials/${id}/datei${download ? '?laden=1' : ''}`;
const mb = (n: number | null) => (n === null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function MaterialPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [list, setList] = useState<Material[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  const load = () =>
    get<{ materials: Material[]; canEdit: boolean }>(`/api/projects/${id}/materials`).then((r) => {
      setList(r.materials);
      setCanEdit(r.canEdit);
    }, fail);

  useEffect(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, fail);
    void load();
  }, [id]);

  async function move(i: number, d: -1 | 1) {
    if (!list) return;
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setList(next);
    await patch(`/api/projects/${id}/materials/${x.id}`, { order: next.map((y) => y.id) }).catch(fail);
  }

  async function rename(x: Material) {
    const title = prompt('Titel', x.title);
    if (title === null) return;
    const note = prompt('Hinweis für die Lernenden (optional)', x.note);
    await patch(`/api/projects/${id}/materials/${x.id}`, { title, note: note ?? x.note }).then(load, fail);
  }

  async function remove(x: Material) {
    if (!confirm(`„${x.title}“ entfernen?`)) return;
    await del(`/api/projects/${id}/materials/${x.id}`).then(load, fail);
  }

  const toggle = (mid: number) => setOpen((o) => (o.has(mid) ? new Set([...o].filter((y) => y !== mid)) : new Set([...o, mid])));

  if (!me || !project) return <Topbar me={me ?? null} />;
  return (
    <ProjectShell me={me} project={project} where="Material">
      <div className={m.wrap}>
        <header className={m.head}>
          <h1>Material zum Einarbeiten</h1>
          <p className="muted">
            {canEdit
              ? 'Was du hier veröffentlichst, sehen alle Lernenden des Projekts von Anfang an, auch beim Start aus Moodle.'
              : 'Hier hat deine Lehrkraft Material zusammengestellt, mit dem du dich in das Thema einarbeitest.'}
          </p>
        </header>
        {error && <div className="error">{error}</div>}
        {canEdit && <AddForm projectId={id} maxMb={project.settings.maxFileMb} onAdded={() => (setError(''), void load())} onError={fail} />}
        {list && list.length === 0 && <p className="muted">{canEdit ? 'Noch kein Material.' : 'Noch kein Material veröffentlicht.'}</p>}
        <ol className={m.list}>
          {list?.map((x, i) => {
            const embed = x.kind === 'video' && x.url ? embedUrl(x.url) : null;
            const viewable = x.kind === 'video' || (x.mime ?? '').startsWith('image/') || x.mime === 'application/pdf';
            const shown = open.has(x.id) || x.kind === 'video' || (x.mime ?? '').startsWith('image/');
            return (
              <li key={x.id} className={`panel ${m.item}`}>
                <div className={m.row}>
                  <span className={m.kind}>{x.kind === 'page' ? 'Lernseite' : x.kind === 'link' ? 'Webseite' : x.kind === 'video' ? 'Video' : x.mime === 'application/pdf' ? 'PDF' : (x.mime ?? '').startsWith('image/') ? 'Bild' : 'Dokument'}</span>
                  <strong className={m.title}>{x.title}</strong>
                  <span className="grow" />
                  {x.kind === 'page' && (
                    <>
                      <a className="btn primary" href={href(`/projekt/material/seite/?id=${id}&m=${x.id}`)}>
                        Lesen
                      </a>
                      {canEdit && (
                        <a className="btn" href={href(`/projekt/material/seite/?id=${id}&m=${x.id}&bearbeiten=1`)}>
                          Schreiben
                        </a>
                      )}
                    </>
                  )}
                  {x.kind === 'link' && x.url && (
                    <a className="btn primary" href={x.url} target="_blank" rel="noopener noreferrer">
                      Öffnen ↗
                    </a>
                  )}
                  {x.kind === 'video' && x.url && !embed && (
                    <a className="btn primary" href={x.url} target="_blank" rel="noopener noreferrer">
                      Video öffnen ↗
                    </a>
                  )}
                  {x.mime === 'application/pdf' && (
                    <button className={`btn ${open.has(x.id) ? 'on' : 'primary'}`} onClick={() => toggle(x.id)}>
                      {open.has(x.id) ? 'Zuklappen' : 'Ansehen'}
                    </button>
                  )}
                  {x.fileName && (
                    <a className="btn" href={fileUrl(id, x.id, !viewable)} target={viewable ? '_blank' : undefined} rel="noopener">
                      {viewable ? 'In neuem Tab' : `Herunterladen (${mb(x.size)})`}
                    </a>
                  )}
                  {canEdit && (
                    <span className={m.tools}>
                      <button className="btn icon" disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben" aria-label="Nach oben">
                        ↑
                      </button>
                      <button className="btn icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Nach unten" aria-label="Nach unten">
                        ↓
                      </button>
                      <button className="btn icon" onClick={() => rename(x)} title="Titel und Hinweis ändern" aria-label="Bearbeiten">
                        <Icon name="pen" size={14} />
                      </button>
                      <button className="btn icon" onClick={() => remove(x)} title="Entfernen" aria-label="Entfernen">
                        <Icon name="close" size={14} />
                      </button>
                    </span>
                  )}
                </div>
                {x.note && <p className={m.note}>{x.note}</p>}
                {x.kind === 'link' && x.url && <small className="muted">{x.url}</small>}
                {shown && embed && (
                  <div className={m.video}>
                    <iframe src={embed} title={x.title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
                  </div>
                )}
                {shown && x.kind === 'video' && x.fileName && <video className={m.media} src={fileUrl(id, x.id)} controls preload="metadata" />}
                {shown && (x.mime ?? '').startsWith('image/') && <img className={m.media} src={fileUrl(id, x.id)} alt={x.title} />}
                {shown && x.mime === 'application/pdf' && <iframe className={m.pdf} src={fileUrl(id, x.id)} title={x.title} />}
              </li>
            );
          })}
        </ol>
      </div>
    </ProjectShell>
  );
}

function AddForm({ projectId, maxMb, onAdded, onError }: { projectId: number; maxMb: number; onAdded: () => void; onError: (e: unknown) => void }) {
  const [kind, setKind] = useState<'page' | 'link' | 'video' | 'file'>('page');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      if (kind === 'page') {
        const r = await post<{ id: number }>(`/api/projects/${projectId}/materials/page`, { title, note });
        location.href = href(`/projekt/material/seite/?id=${projectId}&m=${r.id}&bearbeiten=1`);
        return;
      }
      if (kind === 'file' || (kind === 'video' && file)) {
        if (!file) return;
        const res = await fetch(`${API_URL}${BASE_PATH}/api/projects/${projectId}/materials/file?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string; id?: number };
        if (!res.ok) throw new ApiError(j.error ?? `Fehler ${res.status}`, res.status);
        if (note.trim() && j.id) await patch(`/api/projects/${projectId}/materials/${j.id}`, { note });
      } else await post(`/api/projects/${projectId}/materials`, { kind, url: url.trim(), title, note });
      setUrl('');
      setTitle('');
      setNote('');
      setFile(null);
      onAdded();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  const ready = kind === 'page' ? true : kind === 'file' ? !!file : kind === 'video' ? !!file || url.trim().startsWith('http') : url.trim().startsWith('http');
  return (
    <section className={`panel ${m.add}`}>
      <div className="seg" role="group" aria-label="Art">
        {(
          [
            ['page', 'Lernseite schreiben'],
            ['link', 'Webseite verlinken'],
            ['video', 'Video'],
            ['file', 'PDF oder Dokument (Notlösung)'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`btn ${kind === k ? 'on' : ''}`} onClick={() => (setKind(k), setFile(null))}>
            {l}
          </button>
        ))}
      </div>
      <div className={m.fields}>
        {kind === 'page' && (
          <p className={`muted ${m.span}`}>
            Eine eigene Seite im Tufte-Stil: gut lesbar, mit Randnotizen, Bildern und Videos. Word-Dateien lassen sich im nächsten Schritt übernehmen.
          </p>
        )}
        {(kind === 'link' || kind === 'video') && (
          <div className="field">
            <label>{kind === 'video' ? 'Adresse (YouTube, Vimeo oder andere Seite)' : 'Adresse der Webseite'}</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={!!file} />
          </div>
        )}
        {(kind === 'video' || kind === 'file') && (
          <div className="field">
            <label>{kind === 'video' ? `oder Videodatei (MP4, WebM, bis ${maxMb} MB)` : `Datei (PDF, DOCX, ODT, PPTX, Bild …, bis ${maxMb} MB)`}</label>
            <input
              type="file"
              accept={kind === 'video' ? 'video/mp4,video/webm' : '.pdf,.docx,.odt,.pptx,.odp,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp,.mp3,.m4a'}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
        <div className="field">
          <label>Titel (optional)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'page' ? 'z. B. Die Inflation 1923' : kind === 'link' ? 'z. B. Lexikonartikel' : 'z. B. Einführungsvideo'} />
        </div>
        <div className="field">
          <label>Hinweis für die Lernenden (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Bis Mittwoch lesen, S. 3–5 reichen" />
        </div>
      </div>
      <div className="row">
        <span className="grow" />
        <button className="btn primary" disabled={!ready || busy} onClick={add}>
          {busy ? 'Lädt …' : kind === 'page' ? 'Seite anlegen' : 'Veröffentlichen'}
        </button>
      </div>
    </section>
  );
}
