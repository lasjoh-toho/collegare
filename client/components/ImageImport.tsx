'use client';
/**
 * „Bilder von einer Seite“ (Wunsch Jo, 17. November 2026, nach der Importseite von mod_bento): Adresse einer Seite
 * eingeben, der Server liest sie (Titel, Autor, Lizenz, Bilder mit Bildunterschrift), einige Bilder auswählen,
 * übernehmen. So steht bei jedem Bild die Ursprungsseite, ohne dass jemand sie abtippt.
 */
import { useEffect, useState } from 'react';
import { MAX_IMAGES, proxied, readPage, takeImages, type ImageNoteInput, type PageInfo } from '@/lib/imageDrop';
import c from './imageimport.module.css';

export function ImageImport({ projectId, scope, start = '', addNote, onClose, onDone }: { projectId: number; scope: string; start?: string; addNote: (n: ImageNoteInput) => Promise<{ ok: boolean; error?: string }>; onClose: () => void; onDone: (msg: string) => void }) {
  const [url, setUrl] = useState(start);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function load(u = url) {
    if (!/^https?:\/\//i.test(u.trim())) return setError('Bitte eine Adresse mit http:// oder https:// eingeben.');
    setError('');
    setBusy('Seite wird gelesen …');
    try {
      const p = await readPage(u.trim());
      setPage(p);
      setPicked(new Set());
      setBroken(new Set());
      if (!p.images.length) setError('Auf dieser Seite hat der Server keine Bilder gefunden. Manche Seiten laden ihre Bilder erst im Browser nach; dann zieh die Bilder einzeln herüber.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    if (start) void load(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (u: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(u)) n.delete(u);
      else if (n.size < MAX_IMAGES) n.add(u);
      return n;
    });

  async function take() {
    if (!page) return;
    const imgs = page.images
      .filter((i) => picked.has(i.url))
      .map((i) => ({ url: i.url, alt: i.alt, page: page.url, title: i.caption || i.alt || page.title, credit: page.author, license: page.license }));
    const r = await takeImages(projectId, scope, imgs, addNote, (d, all) => setBusy(`Bild ${Math.min(d + 1, all)} von ${all} …`));
    setBusy('');
    if (r.error && !r.added) return setError(r.error);
    onDone(r.added === 1 ? '1 Bild übernommen' : `${r.added} Bilder übernommen${r.error ? ` (${r.error})` : ''}`);
    onClose();
  }

  const shown = page?.images.filter((i) => !broken.has(i.url)) ?? [];
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`modal ${c.modal}`} role="dialog" aria-label="Bilder von einer Seite">
        <h2>Bilder von einer Seite</h2>
        <p className="muted">Adresse der Seite einfügen, auf der die Bilder stehen. Die Seite wird als Ursprung bei jedem Bild vermerkt, dazu Autor und Lizenz, soweit die Seite sie angibt. Höchstens {MAX_IMAGES} Bilder auf einmal.</p>
        <form
          className={c.form}
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Adresse der Seite" autoFocus />
          <button className="btn" type="submit" disabled={!!busy}>
            Seite lesen
          </button>
        </form>
        {page && (
          <p className={`muted ${c.meta}`}>
            <strong>{page.title || page.site}</strong>
            {page.site && page.title ? ` · ${page.site}` : ''}
            {page.author ? ` · ${page.author}` : ''}
            {page.license ? ` · ${page.license}` : ' · keine Lizenz angegeben'}
          </p>
        )}
        {shown.length > 0 && (
          <div className={c.grid}>
            {shown.map((i) => (
              <label key={i.url} className={`${c.pick} ${picked.has(i.url) ? c.on : ''}`} title={i.url}>
                <input type="checkbox" checked={picked.has(i.url)} onChange={() => toggle(i.url)} />
                <img src={proxied(i.url)} alt={i.alt} loading="lazy" onError={() => setBroken((b) => new Set(b).add(i.url))} />
                <span className={c.cap}>{i.caption || i.alt || i.url.split('/').pop()}</span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <span className="muted">{busy || (page ? `${picked.size} von höchstens ${MAX_IMAGES} ausgewählt` : '')}</span>
          <span className="grow" />
          <button className="btn" onClick={onClose} disabled={!!busy}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => void take()} disabled={!picked.size || !!busy}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
