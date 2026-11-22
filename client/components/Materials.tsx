'use client';
/**
 * Bausteine für Material (Wunsch Jo, 11., 14. und 20. November 2026): Liste mit Anzeige von Lernseiten, Webseiten,
 * Videos und Dateien, Formular zum Anlegen, Schlagworte und die Auswahl, für wen ein Material freigegeben ist
 * (alle Lernenden, einzelne Gruppen, einzelne Personen). Gebraucht im Projekt („Material zum Einarbeiten“) und im
 * Portal („Materialien“ der Werkstatt einer Lehrkraft).
 */
import { useEffect, useState } from 'react';
import { API_URL, ApiError, BASE_PATH, get, href, patch, post } from '@/lib/api';
import m from '@/app/projekt/material/material.module.css';
import { Icon } from './Icon';
import { blankDoc } from '@/lib/blatt';

export interface Audience {
  groups: number[];
  users: number[];
}

export interface Material {
  id: number;
  kind: 'link' | 'video' | 'file' | 'page' | 'blatt';
  title: string;
  url: string | null;
  note: string;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  visible: boolean;
  tags: string[];
  audience: Audience | null;
  sourceId: number | null;
  createdAt: number;
}

/** Ziel zum Übernehmen bzw. Projekt, dessen Gruppen und Lernende zur Auswahl stehen */
export interface Target {
  id: number;
  title: string;
  mode: string;
  groups: { id: number; title: string }[];
  members: { id: number; name: string; groupId: number | null }[];
}

/** Einbettbare Adresse für YouTube und Vimeo, sonst null. */
export function embedUrl(url: string): string | null {
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

export const fileUrl = (projectId: number, id: number, download = false) => `${API_URL}${BASE_PATH}/api/projects/${projectId}/materials/${id}/datei${download ? '?laden=1' : ''}`;
export const mb = (n: number | null) => (n === null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const kindLabel = (x: Material) =>
  x.kind === 'page' ? 'Lernseite' : x.kind === 'blatt' ? 'Arbeitsblatt' : x.kind === 'link' ? 'Webseite' : x.kind === 'video' ? 'Video' : x.mime === 'application/pdf' ? 'PDF' : (x.mime ?? '').startsWith('image/') ? 'Bild' : 'Dokument';

/** Kurztext, für wen ein Material freigegeben ist */
export function audienceText(a: Audience | null, t: Pick<Target, 'groups' | 'members'> | null): string {
  if (!a) return 'für alle Lernenden';
  const names = [...a.groups.map((g) => t?.groups.find((x) => x.id === g)?.title ?? 'Gruppe'), ...a.users.map((u) => t?.members.find((x) => x.id === u)?.name ?? 'Person')];
  return 'nur für ' + (names.length > 3 ? `${names.slice(0, 3).join(', ')} und ${names.length - 3} weitere` : names.join(', '));
}

/** Anzeige eines Materials: Kopfzeile mit Art, Titel und Knöpfen (von außen), darunter Hinweis und Vorschau. */
export function MaterialBody({ projectId, x, open }: { projectId: number; x: Material; open: boolean }) {
  const embed = x.kind === 'video' && x.url ? embedUrl(x.url) : null;
  const shown = open || x.kind === 'video' || (x.mime ?? '').startsWith('image/');
  return (
    <>
      {x.note && <p className={m.note}>{x.note}</p>}
      {x.kind === 'link' && x.url && <small className="muted">{x.url}</small>}
      {shown && embed && (
        <div className={m.video}>
          <iframe src={embed} title={x.title} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      )}
      {shown && x.kind === 'video' && x.fileName && <video className={m.media} src={fileUrl(projectId, x.id)} controls preload="metadata" />}
      {shown && (x.mime ?? '').startsWith('image/') && <img className={m.media} src={fileUrl(projectId, x.id)} alt={x.title} />}
      {shown && x.mime === 'application/pdf' && <iframe className={m.pdf} src={fileUrl(projectId, x.id)} title={x.title} />}
    </>
  );
}

/** Knöpfe zum Öffnen: Lesen/Schreiben, Webseite, Video, PDF, Datei */
export function OpenButtons({ projectId, x, canEdit, open, onToggle }: { projectId: number; x: Material; canEdit: boolean; open: boolean; onToggle: () => void }) {
  const embed = x.kind === 'video' && x.url ? embedUrl(x.url) : null;
  const viewable = x.kind === 'video' || (x.mime ?? '').startsWith('image/') || x.mime === 'application/pdf';
  return (
    <>
      {x.kind === 'page' && (
        <>
          <a className="btn primary" href={href(`/projekt/material/seite/?id=${projectId}&m=${x.id}`)}>
            Lesen
          </a>
          {canEdit && (
            <a className="btn" href={href(`/projekt/material/seite/?id=${projectId}&m=${x.id}&bearbeiten=1`)}>
              Schreiben
            </a>
          )}
        </>
      )}
      {x.kind === 'blatt' && (
        <a className="btn primary" href={href(`/projekt/material/blatt/?id=${projectId}&m=${x.id}`)}>
          {canEdit ? 'Bearbeiten' : 'Ansehen'}
        </a>
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
        <button className={`btn ${open ? 'on' : 'primary'}`} onClick={onToggle}>
          {open ? 'Zuklappen' : 'Ansehen'}
        </button>
      )}
      {x.fileName && (
        <a className="btn" href={fileUrl(projectId, x.id, !viewable)} target={viewable ? '_blank' : undefined} rel="noopener">
          {viewable ? 'In neuem Tab' : `Herunterladen (${mb(x.size)})`}
        </a>
      )}
    </>
  );
}

/** Schlagworte: Chips mit ×, neues Schlagwort mit Eingabe und Enter (oder Komma) */
export function TagEditor({ tags, all, onChange }: { tags: string[]; all: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState('');
  const add = (value = text) => {
    const more = value.split(',').map((t) => t.trim()).filter(Boolean);
    setText('');
    if (more.length) onChange([...new Set([...tags, ...more])]);
  };
  return (
    <span className={m.tagEdit}>
      {tags.map((t) => (
        <span key={t} className={m.tag}>
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Schlagwort ${t} entfernen`} title="Entfernen">
            <Icon name="close" size={10} />
          </button>
        </span>
      ))}
      <input
        className={m.tagInput}
        value={text}
        list="material-schlagworte"
        placeholder={tags.length ? '+ Schlagwort' : '+ Schlagwort, z. B. Einführung'}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        onBlur={() => add()}
      />
      <datalist id="material-schlagworte">
        {all.filter((t) => !tags.includes(t)).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </span>
  );
}

/** Auswahl, für wen: alle Lernenden, bestimmte Gruppen, bestimmte Personen */
export function AudiencePicker({ target, value, onChange }: { target: Target; value: Audience | null; onChange: (a: Audience | null) => void }) {
  const [mode, setMode] = useState<'all' | 'some'>(value ? 'some' : 'all');
  const a = value ?? { groups: [], users: [] };
  const flip = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const set = (next: Audience) => onChange(next.groups.length || next.users.length ? next : { groups: [], users: [] });
  return (
    <div className={m.audience}>
      <div className="seg" role="group" aria-label="Für wen">
        <button className={`btn ${mode === 'all' ? 'on' : ''}`} onClick={() => (setMode('all'), onChange(null))}>
          Alle Lernenden
        </button>
        <button className={`btn ${mode === 'some' ? 'on' : ''}`} onClick={() => (setMode('some'), onChange(a))}>
          Bestimmte Gruppen oder Lernende
        </button>
      </div>
      {mode === 'some' && (
        <div className={m.pick}>
          {target.mode === 'group' && (
            <div>
              <div className="label">Gruppen</div>
              {target.groups.length === 0 && <p className="muted">Noch keine Gruppen gebildet.</p>}
              {target.groups.map((g) => (
                <label key={g.id} className={m.check}>
                  <input type="checkbox" checked={a.groups.includes(g.id)} onChange={() => set({ ...a, groups: flip(a.groups, g.id) })} /> {g.title}
                </label>
              ))}
            </div>
          )}
          <div>
            <div className="label">Einzelne Lernende</div>
            {target.members.length === 0 && <p className="muted">Noch keine Lernenden im Projekt.</p>}
            {target.members.map((u) => (
              <label key={u.id} className={m.check}>
                <input type="checkbox" checked={a.users.includes(u.id)} onChange={() => set({ ...a, users: flip(a.users, u.id) })} /> {u.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fenster „Für wen?“ für ein Material im Projekt */
export function AudienceDialog({ projectId, x, target, onClose, onSaved, onError }: { projectId: number; x: Material; target: Target; onClose: () => void; onSaved: () => void; onError: (e: unknown) => void }) {
  const [a, setA] = useState<Audience | null>(x.audience);
  const empty = !!a && !a.groups.length && !a.users.length;
  async function save() {
    await patch(`/api/projects/${projectId}/materials/${x.id}`, { audience: a && (a.groups.length || a.users.length) ? a : null }).then(onSaved, onError);
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Für wen">
        <h2>Für wen ist „{x.title}“?</h2>
        <AudiencePicker target={target} value={a} onChange={setA} />
        <p className="muted">{x.visible ? 'Das Material ist freigegeben.' : 'Das Material ist noch unsichtbar; die Auswahl gilt, sobald du es freigibst.'}</p>
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={empty} onClick={save}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Übernehmen aus den „Materialien“ in ein Projekt (Kopie). Mit fester `to` wählt man das Material (Projektseite),
 * mit festem `item` das Projekt (Materialien-Seite).
 */
export function CopyDialog(props: { werkstatt: number; item?: Material; library?: Material[]; to?: Target; targets: Target[]; onClose: () => void; onDone: (msg: string, projectId: number) => void; onError: (e: unknown) => void }) {
  const [toId, setToId] = useState<number | null>(props.to?.id ?? props.targets[0]?.id ?? null);
  const [picked, setPicked] = useState<Set<number>>(new Set(props.item ? [props.item.id] : []));
  const [a, setA] = useState<Audience | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const target = props.to ?? props.targets.find((t) => t.id === toId) ?? null;
  const empty = !!a && !a.groups.length && !a.users.length;
  useEffect(() => setA(null), [toId]);

  async function run() {
    if (!target) return;
    setBusy(true);
    try {
      for (const id of picked) await post(`/api/projects/${props.werkstatt}/materials/${id}/kopieren`, { to: target.id, visible, audience: a && (a.groups.length || a.users.length) ? a : null });
      props.onDone(`${picked.size === 1 ? 'Ein Material' : `${picked.size} Materialien`} in „${target.title}“ übernommen${visible ? ' und freigegeben' : ' (noch unsichtbar)'}.`, target.id);
    } catch (e) {
      props.onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${m.copyModal}`} role="dialog" aria-label="Ins Projekt übernehmen">
        <h2>{props.item ? `„${props.item.title}“ in ein Projekt übernehmen` : 'Aus deinen Materialien übernehmen'}</h2>
        {props.library && (
          <div className={m.pickList}>
            {props.library.length === 0 && (
              <p className="muted">
                Unter <a href={href('/materialien/')}>Materialien</a> im Portal ist noch nichts. Dort legst du Material einmal an und übernimmst es in beliebig viele Projekte.
              </p>
            )}
            {props.library.map((x) => (
              <label key={x.id} className={m.check}>
                <input type="checkbox" checked={picked.has(x.id)} onChange={() => setPicked((s) => (s.has(x.id) ? new Set([...s].filter((y) => y !== x.id)) : new Set([...s, x.id])))} />
                <span className={m.kind}>{kindLabel(x)}</span> {x.title}
                {x.tags.map((t) => (
                  <span key={t} className={m.tag}>
                    {t}
                  </span>
                ))}
              </label>
            ))}
          </div>
        )}
        {!props.to && (
          <div className="field">
            <label>Projekt</label>
            {props.targets.length === 0 ? (
              <p className="muted">Du hast noch kein Projekt.</p>
            ) : (
              <select value={toId ?? ''} onChange={(e) => setToId(Number(e.target.value))}>
                {props.targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {target && <AudiencePicker key={target.id} target={target} value={a} onChange={setA} />}
        <label className={m.check}>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> gleich freigeben (sonst zuerst unsichtbar wie neues Material)
        </label>
        <p className="muted">Übernommen wird eine Kopie: Änderungen hier ändern das Material in laufenden Projekten nicht.</p>
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={props.onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!target || !picked.size || empty || busy} onClick={run}>
            {busy ? 'Übernimmt …' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ziele (eigene Projekte mit Gruppen und Lernenden) für die Auswahl */
export const loadTargets = () => get<{ projects: Target[] }>('/api/werkstatt/ziele').then((r) => r.projects);

/** Formular zum Anlegen: Lernseite, Webseite, Video, Datei */
export function AddForm({ projectId, maxMb, onAdded, onError, library = false, initial = 'page' }: { projectId: number; maxMb: number; onAdded: () => void; onError: (e: unknown) => void; library?: boolean; initial?: 'page' | 'blatt' }) {
  const [kind, setKind] = useState<'page' | 'blatt' | 'link' | 'video' | 'file'>(initial);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibleRaw, setVisible] = useState(false);
  // in den Materialien gibt es keine Lernenden; sichtbar wird erst die Kopie im Projekt
  const visible = library ? true : visibleRaw;

  async function add() {
    setBusy(true);
    try {
      if (kind === 'blatt') {
        const r = await post<{ id: number }>(`/api/projects/${projectId}/materials/page`, { kind: 'blatt', title, note, visible, body: JSON.stringify(blankDoc(title.trim())) });
        location.href = href(`/projekt/material/blatt/?id=${projectId}&m=${r.id}`);
        return;
      }
      if (kind === 'page') {
        const r = await post<{ id: number }>(`/api/projects/${projectId}/materials/page`, { title, note, visible });
        location.href = href(`/projekt/material/seite/?id=${projectId}&m=${r.id}&bearbeiten=1`);
        return;
      }
      if (kind === 'file' || (kind === 'video' && file)) {
        if (!file) return;
        const res = await fetch(`${API_URL}${BASE_PATH}/api/projects/${projectId}/materials/file?name=${encodeURIComponent(file.name)}&title=${encodeURIComponent(title)}&sichtbar=${visible ? 1 : 0}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/octet-stream' },
          body: file,
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string; id?: number };
        if (!res.ok) throw new ApiError(j.error ?? `Fehler ${res.status}`, res.status);
        if (note.trim() && j.id) await patch(`/api/projects/${projectId}/materials/${j.id}`, { note });
      } else await post(`/api/projects/${projectId}/materials`, { kind, url: url.trim(), title, note, visible });
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

  const ready = kind === 'page' || kind === 'blatt' ? true : kind === 'file' ? !!file : kind === 'video' ? !!file || url.trim().startsWith('http') : url.trim().startsWith('http');
  return (
    <section className={`panel ${m.add}`}>
      <div className="seg" role="group" aria-label="Art">
        {(
          [
            ['page', 'Lernseite schreiben'],
            ['blatt', 'Arbeitsblatt oder Klassenarbeit'],
            ['link', 'Webseite verlinken'],
            ['video', 'Video'],
            ['file', 'PDF oder Dokument'],
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
        {kind === 'blatt' && (
          <p className={`muted ${m.span}`}>
            Zum Ausdrucken: Material mit Zeilenzählung, Bilder, Aufgaben, Schreiblinien oder Karos, auf Wunsch als Broschüre und mit persönlichem QR-Code aus Autogra.fi.
          </p>
        )}
        {kind === 'file' && (
          <p className={`${m.hint} ${m.span}`}>
            Überleg dir, auf welchen Geräten die Lernenden das Material ansehen werden. PDFs und Word-Dateien sind am Handy oft mühsam zu lesen; eine Lernseite passt sich
            jedem Bildschirm an.
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'blatt' ? 'z. B. Klausur S 4: Wirtschaft im NS' : kind === 'page' ? 'z. B. Die Inflation 1923' : kind === 'link' ? 'z. B. Lexikonartikel' : 'z. B. Einführungsvideo'} />
        </div>
        <div className="field">
          <label>Hinweis für die Lernenden (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Bis Mittwoch lesen, S. 3–5 reichen" />
        </div>
      </div>
      <div className="row">
        {!library && (
          <label className={m.check}>
            <input type="checkbox" checked={visibleRaw} onChange={(e) => setVisible(e.target.checked)} /> gleich für die Lernenden freigeben
          </label>
        )}
        <span className="grow" />
        <button className="btn primary" disabled={!ready || busy} onClick={add}>
          {busy ? 'Lädt …' : kind === 'page' ? 'Seite anlegen' : kind === 'blatt' ? 'Blatt anlegen' : library ? 'Anlegen' : visible ? 'Veröffentlichen' : 'Anlegen (noch unsichtbar)'}
        </button>
      </div>
    </section>
  );
}
