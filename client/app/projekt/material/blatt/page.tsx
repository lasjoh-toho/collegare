'use client';
/**
 * Arbeitsblatt und Klassenarbeit (Material, Art „blatt“; Wunsch Jo, 22. November 2026).
 *
 * Links das Blatt (Format, Broschüre, Kopfzeile) und die Bausteine, in der Mitte die Seiten so, wie sie gedruckt
 * werden, rechts der gewählte Baustein. Gesetzt wird mit lib/blatt.ts. Drucken: ein Exemplar ohne Code oder je Person
 * einer Autogra.fi-Aufgabe ein Exemplar mit deren persönlichem QR-Code (Klassenliste und Codes holt der Browser dort,
 * mit der Anmeldung in Autogra.fi). Die Broschüre wird ausgeschossen: Seite 1 steht auf dem Bogen neben der letzten.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { RichText } from '@/components/RichText';
import { fileUrl, type Material } from '@/components/Materials';
import { ApiError, get, href, patch } from '@/lib/api';
import { BLOCK_LABEL, blockSummary, newBlock, paginate, parseDoc, sheetSize, toSheets, uid, type BlattDoc, type Block, type BlockType, type Copy, type Problem, type Ruling } from '@/lib/blatt';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import st from './blatt.module.css';

interface Page {
  id: number;
  kind: string;
  title: string;
  note: string;
  body: string;
}

const ICON: Record<BlockType, string> = { heading: 'H', text: '¶', material: '❝', quote: '“', image: '▣', task: '✎', box: '▢', lines: '≡', pagebreak: '⤓' };
const ADD: BlockType[] = ['material', 'image', 'task', 'text', 'quote', 'box', 'heading', 'lines', 'pagebreak'];
const MAX = 4_000_000;

const INFO = `Hier entsteht ein Arbeitsblatt oder eine Klassenarbeit zum Ausdrucken.

Links legst du das Format fest und fügst Bausteine hinzu: Material (mit Zeilenzählung alle fünf Zeilen und Quelle als Fußnote), Bild, Aufgabe (wird von selbst nummeriert, mit Punkten und Antwortlinien), Erklärtext, Zitat, Kasten (z. B. Operatoren), Überschrift, Linien und Seitenumbruch. Die Reihenfolge änderst du mit den Pfeilen oder durch Ziehen.

In der Mitte siehst du die Seiten so, wie sie gedruckt werden. Ein Klick auf einen Baustein wählt ihn aus; rechts bearbeitest du ihn. Bilder ziehst du einfach auf die Seite. Rot umrandet ist, was nicht auf eine Seite passt.

„Linien bis zum Seitenende“ füllt den Rest einer Seite mit Schreiblinien, Karos (Mathe) oder Freiraum.

Broschüre: Die Seiten werden auf ein Vielfaches von vier aufgefüllt (mit Linien, Karos oder leer) und so auf die Bögen verteilt, dass nach dem Falten alles in der richtigen Reihenfolge liegt; die erste Seite steht also neben der letzten. Aus A5-Seiten werden A4-Bögen (quer), aus A4-Seiten A3-Bögen. Beidseitig drucken und an der kurzen Kante wenden.

QR-Code: Beim Drucken wählst du eine Aufgabe in Autogra.fi. Dann bekommt jede Person ein eigenes Exemplar mit ihrem QR-Code und Kurzcode, auf Wunsch mit Namen. Dafür musst du im selben Browser in Autogra.fi angemeldet sein.`;

/** Bild verkleinern (längste Seite 1600 px) und als data:-Adresse zurückgeben (wie bei Lernseiten). */
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
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function BlattPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const mParam = useQuery('m');
  const id = idParam ? Number(idParam) : NaN;
  const mid = mParam ? Number(mParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [doc, setDoc] = useState<BlattDoc | null>(null);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'ok' | 'dirty' | 'saving'>('ok');
  const [view, setView] = useState<'pages' | 'sheets'>('pages');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [showPage, setShowPage] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const history = useRef<{ undo: BlattDoc[]; redo: BlattDoc[]; last: number }>({ undo: [], redo: [], last: 0 });

  useEffect(() => {
    if (!Number.isInteger(id) || !Number.isInteger(mid)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setError(String(e.message ?? e)));
    get<{ page: Page; canEdit: boolean }>(`/api/projects/${id}/materials/${mid}`).then(
      (r) => {
        setPage(r.page);
        setTitle(r.page.title);
        setDoc(parseDoc(r.page.body, r.page.title));
        setCanEdit(r.canEdit);
      },
      (e) => setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [id, mid]);

  // ---------- Ändern, Rückgängig, Speichern ----------
  const change = useCallback((fn: (d: BlattDoc) => BlattDoc) => {
    setDoc((d) => {
      if (!d) return d;
      const h = history.current;
      // kurz hintereinander Getipptes ist ein Schritt
      if (Date.now() - h.last > 800) {
        h.undo.push(d);
        if (h.undo.length > 60) h.undo.shift();
      }
      h.last = Date.now();
      h.redo = [];
      return fn(d);
    });
    setSaved('dirty');
  }, []);
  const undo = () => {
    const h = history.current;
    const prev = h.undo.pop();
    if (!prev || !doc) return;
    h.redo.push(doc);
    h.last = 0;
    setDoc(prev);
    setSaved('dirty');
  };
  const redo = () => {
    const h = history.current;
    const nx = h.redo.pop();
    if (!nx || !doc) return;
    h.undo.push(doc);
    h.last = 0;
    setDoc(nx);
    setSaved('dirty');
  };
  const setBlock = (bid: string, patchB: Partial<Block>) => change((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === bid ? { ...b, ...patchB } : b)) }));
  const setPageOpt = (p: Partial<BlattDoc['page']>) => change((d) => ({ ...d, page: { ...d.page, ...p } }));
  const setHeader = (p: Partial<BlattDoc['page']['header']>) => change((d) => ({ ...d, page: { ...d.page, header: { ...d.page.header, ...p } } }));

  const body = useMemo(() => (doc ? JSON.stringify(doc) : ''), [doc]);
  const save = useCallback(async () => {
    if (!doc || !canEdit) return;
    if (body.length > MAX) {
      setError('Das Blatt ist zu groß (höchstens 4 MB samt Bildern). Bitte große Bilder entfernen oder kleiner einsetzen.');
      return;
    }
    setSaved('saving');
    try {
      await patch(`/api/projects/${id}/materials/${mid}`, { title: title.trim() || 'Ohne Titel', body });
      setSaved((s) => (s === 'saving' ? 'ok' : s));
      setError('');
    } catch (e) {
      setSaved('dirty');
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [doc, canEdit, body, id, mid, title]);
  useEffect(() => {
    if (saved !== 'dirty') return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [saved, body, title, save]);
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (saved !== 'ok') ev.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      } else if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // ---------- Setzen ----------
  useLayoutEffect(() => {
    const h = host.current;
    if (!h || !doc) return;
    const r = paginate(doc, h);
    setProblems(r.problems);
    setPageCount(r.pages.length);
    if (view === 'sheets') {
      const tmp = document.createElement('div');
      toSheets(doc, r.pages, tmp);
      h.replaceChildren(...tmp.children);
    }
  }, [doc, view, canEdit]);
  useLayoutEffect(() => {
    host.current?.querySelectorAll('.bl-sel').forEach((e) => e.classList.remove('bl-sel'));
    if (sel) host.current?.querySelectorAll(`[data-bid="${sel}"]`).forEach((e) => e.classList.add('bl-sel'));
  });
  // auf die Breite der Mitte einpassen
  useEffect(() => {
    const c = center.current;
    if (!c || !doc) return;
    const fit = () => {
      const sz = view === 'sheets' ? sheetSize(doc) : { w: doc.page.size === 'a5' ? 148 : 210 };
      const px = sz.w * 3.7795 + 40;
      setZoom(Math.min(1, Math.max(0.35, (c.clientWidth - 8) / px)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [doc?.page.size, doc?.page.booklet, view, doc]);

  // ---------- Bausteine ----------
  const selBlock = doc?.blocks.find((b) => b.id === sel) ?? null;
  function add(type: BlockType, extra: Partial<Block> = {}) {
    const b = { ...newBlock(type), ...extra };
    change((d) => {
      const i = sel ? d.blocks.findIndex((x) => x.id === sel) : -1;
      const blocks = [...d.blocks];
      blocks.splice(i < 0 ? blocks.length : i + 1, 0, b);
      return { ...d, blocks };
    });
    setSel(b.id);
  }
  function move(bid: string, dir: -1 | 1) {
    change((d) => {
      const i = d.blocks.findIndex((b) => b.id === bid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...d, blocks };
    });
  }
  function moveTo(bid: string, beforeId: string | null) {
    if (bid === beforeId) return;
    change((d) => {
      const b = d.blocks.find((x) => x.id === bid);
      if (!b) return d;
      const rest = d.blocks.filter((x) => x.id !== bid);
      const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : rest.length;
      rest.splice(at < 0 ? rest.length : at, 0, b);
      return { ...d, blocks: rest };
    });
  }
  function remove(bid: string) {
    change((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== bid) }));
    if (sel === bid) setSel(null);
  }
  function duplicate(bid: string) {
    const nid = uid();
    change((d) => {
      const i = d.blocks.findIndex((b) => b.id === bid);
      const blocks = [...d.blocks];
      blocks.splice(i + 1, 0, { ...d.blocks[i], id: nid });
      return { ...d, blocks };
    });
    setSel(nid);
  }
  async function imageInto(file: Blob, bid: string | null) {
    try {
      const src = await shrink(file);
      if (bid && doc?.blocks.find((b) => b.id === bid)?.type === 'image') setBlock(bid, { src });
      else add('image', { src });
    } catch {
      setError('Das Bild ließ sich nicht lesen.');
    }
  }

  // Klick, Ziehen und Einsetzen auf den Seiten
  function onPagesClick(e: React.MouseEvent) {
    if (!canEdit) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bid]');
    if (t?.dataset.bid) setSel(t.dataset.bid);
  }
  function onPagesDrop(e: React.DragEvent) {
    if (!canEdit) return;
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bid]');
    void imageInto(f, t?.dataset.bid ?? null);
  }
  useEffect(() => {
    if (!canEdit) return;
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        void imageInto(f, sel);
      }
    };
    addEventListener('paste', paste);
    return () => removeEventListener('paste', paste);
  });

  if (!me || !project) return <Topbar me={me ?? null} />;
  const bad = new Set(problems.map((p) => p.bid));
  const editing = canEdit;
  return (
    <ProjectShell
      me={me}
      project={project}
      where="Material"
      fill
      info={{ key: 'blatt', title: 'Arbeitsblatt und Klassenarbeit', text: INFO }}
      crumbs={page ? <span className="muted">{title || page.title}</span> : null}
      actions={
        <>
          <a className="btn" href={href(project.werkstatt ? '/materialien/' : `/projekt/material/?id=${id}`)}>
            ← {project.werkstatt ? 'Materialien' : 'Material'}
          </a>
          {editing && (
            <>
              <button className="btn" onClick={undo} disabled={!history.current.undo.length} title="Rückgängig (Strg+Z)">
                ↶
              </button>
              <button className="btn" onClick={redo} disabled={!history.current.redo.length} title="Wiederholen (Strg+Umschalt+Z)">
                ↷
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                {saved === 'ok' ? 'Gespeichert' : saved === 'saving' ? 'Speichert …' : 'Nicht gespeichert'}
              </span>
            </>
          )}
          <button className="btn primary" onClick={() => setPrinting(true)} disabled={!doc}>
            Drucken …
          </button>
        </>
      }
    >
      {error && <div className="error">{error}</div>}
      {doc && (
        <div className={`${st.wrap} ${editing ? '' : st.read}`}>
          {editing && (
            <aside className={st.side}>
              <input className={st.titleIn} value={title} onChange={(e) => (setTitle(e.target.value), setSaved('dirty'))} placeholder="Name des Blatts" aria-label="Name des Blatts" />
              <section className={st.sec}>
                <button className={st.secHead} onClick={() => setShowPage((v) => !v)} aria-expanded={showPage}>
                  {showPage ? '▾' : '▸'} Blatt
                </button>
                {showPage && (
                  <>
                    <div className={st.grid2}>
                      <div className="field">
                        <label>Seitengröße</label>
                        <select value={doc.page.size} onChange={(e) => setPageOpt({ size: e.target.value as 'a4' | 'a5' })}>
                          <option value="a4">A4</option>
                          <option value="a5">A5</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Schrift</label>
                        <select value={`${doc.page.font}-${doc.page.fontSize}`} onChange={(e) => {
                          const [font, size] = e.target.value.split('-');
                          setPageOpt({ font: font as 'sans' | 'serif', fontSize: Number(size) });
                        }}>
                          {(['sans', 'serif'] as const).flatMap((f) =>
                            [10, 11, 12].map((s) => (
                              <option key={f + s} value={`${f}-${s}`}>
                                {f === 'sans' ? 'Ohne Serifen' : 'Mit Serifen'} {s} pt
                              </option>
                            )),
                          )}
                        </select>
                      </div>
                    </div>
                    <label className={st.check}>
                      <input type="checkbox" checked={doc.page.booklet} onChange={(e) => setPageOpt({ booklet: e.target.checked })} /> Als Broschüre drucken ({doc.page.size === 'a5' ? 'auf A4 quer' : 'auf A3 quer'})
                    </label>
                    {doc.page.booklet && (
                      <div className="field">
                        <label>Leere Seiten am Ende füllen mit</label>
                        <select value={doc.page.fill} onChange={(e) => setPageOpt({ fill: e.target.value as Ruling })}>
                          <option value="lines">Schreiblinien</option>
                          <option value="grid">Karos (Mathe)</option>
                          <option value="empty">nichts</option>
                        </select>
                      </div>
                    )}
                    <label className={st.check}>
                      <input type="checkbox" checked={doc.page.header.show} onChange={(e) => setHeader({ show: e.target.checked })} /> Kopfzeile auf der ersten Seite
                    </label>
                    {doc.page.header.show && (
                      <>
                        <div className="field">
                          <label>Text der Kopfzeile</label>
                          <input value={doc.page.header.text} onChange={(e) => setHeader({ text: e.target.value })} placeholder="z. B. Klausur S 4" />
                        </div>
                        <div className={st.grid2}>
                          <label className={st.check}>
                            <input type="checkbox" checked={doc.page.header.nameLine} onChange={(e) => setHeader({ nameLine: e.target.checked })} /> Name
                          </label>
                          <label className={st.check}>
                            <input type="checkbox" checked={doc.page.header.date} onChange={(e) => setHeader({ date: e.target.checked })} /> Datum
                          </label>
                        </div>
                      </>
                    )}
                    <div className="field">
                      <label>QR-Code für Autogra.fi</label>
                      <select value={doc.page.header.qr} onChange={(e) => setHeader({ qr: e.target.value as 'first' | 'all' | 'none', show: e.target.value !== 'none' || doc.page.header.show })}>
                        <option value="none">keiner</option>
                        <option value="first">auf der ersten Seite</option>
                        <option value="all">auf jeder Seite</option>
                      </select>
                    </div>
                    <label className={st.check}>
                      <input type="checkbox" checked={doc.page.pageNumbers} onChange={(e) => setPageOpt({ pageNumbers: e.target.checked })} /> Seitenzahlen
                    </label>
                  </>
                )}
              </section>
              <section className={st.sec}>
                <div className={st.secHead}>Baustein hinzufügen</div>
                <div className={st.add}>
                  {ADD.map((t) => (
                    <button key={t} className="btn" onClick={() => add(t)} title={`${BLOCK_LABEL[t]} ${sel ? 'nach dem gewählten Baustein' : 'am Ende'} einfügen`}>
                      <span>{ICON[t]}</span>
                      {BLOCK_LABEL[t]}
                    </button>
                  ))}
                </div>
              </section>
              <section className={st.sec}>
                <div className={st.secHead}>Bausteine</div>
                {!doc.blocks.length && <div className={st.empty}>Noch leer. Füg oben Material, Bilder und Aufgaben hinzu.</div>}
                <div className={st.list} onDragOver={(e) => dragId && e.preventDefault()} onDrop={() => dragId && (moveTo(dragId, dropAt), setDragId(null), setDropAt(null))}>
                  {doc.blocks.map((b, i) => (
                    <div
                      key={b.id}
                      className={`${st.item} ${sel === b.id ? st.sel : ''} ${bad.has(b.id) ? st.bad : ''} ${dragId === b.id ? st.drag : ''} ${dropAt === b.id && dragId !== b.id ? st.dropAbove : ''}`}
                      onClick={() => setSel(b.id)}
                      draggable
                      onDragStart={(e) => (setDragId(b.id), e.dataTransfer.setData('text/plain', b.id))}
                      onDragOver={() => dragId && setDropAt(b.id)}
                      onDragEnd={() => (setDragId(null), setDropAt(null))}
                      title={bad.has(b.id) ? problems.find((p) => p.bid === b.id)?.msg : undefined}
                    >
                      <span className={st.itemIcon}>{ICON[b.type]}</span>
                      <span className={st.itemText}>
                        {BLOCK_LABEL[b.type]}
                        <small>{blockSummary(b)}</small>
                      </span>
                      <span className={st.itemBtns}>
                        <button className="btn" onClick={(e) => (e.stopPropagation(), move(b.id, -1))} disabled={i === 0} title="nach oben">
                          ↑
                        </button>
                        <button className="btn" onClick={(e) => (e.stopPropagation(), move(b.id, 1))} disabled={i === doc.blocks.length - 1} title="nach unten">
                          ↓
                        </button>
                        <button className="btn" onClick={(e) => (e.stopPropagation(), duplicate(b.id))} title="verdoppeln">
                          ⧉
                        </button>
                        <button className="btn danger" onClick={(e) => (e.stopPropagation(), remove(b.id))} title="entfernen">
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                  {dragId && <div className={`${st.empty} ${dropAt === null ? '' : ''}`} onDragOver={() => setDropAt(null)}>ans Ende</div>}
                </div>
              </section>
            </aside>
          )}

          <div className={st.center} ref={center}>
            <div className={st.viewBar}>
              <div className="seg" role="group" aria-label="Ansicht">
                <button className={`btn ${view === 'pages' ? 'on' : ''}`} onClick={() => setView('pages')}>
                  Seiten
                </button>
                <button className={`btn ${view === 'sheets' ? 'on' : ''}`} onClick={() => setView('sheets')} title="So liegen die Seiten auf dem Papier">
                  Druckbögen
                </button>
              </div>
              <span>
                {pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'} {doc.page.size.toUpperCase()}
                {doc.page.booklet ? `, ${pageCount / 4} ${pageCount / 4 === 1 ? 'Bogen' : 'Bögen'} ${sheetSize(doc).name}` : ''}
              </span>
              {problems.length > 0 && <span className={st.warn}>{problems.length === 1 ? 'Ein Baustein passt' : `${problems.length} Bausteine passen`} nicht auf eine Seite</span>}
            </div>
            <div className={st.pagesOuter} onClick={onPagesClick} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={onPagesDrop}>
              <div ref={host} className={`${st.host} ${editing ? st.editing : ''} ${view === 'sheets' ? st.sheets : ''}`} style={{ zoom } as React.CSSProperties} />
            </div>
          </div>

          {editing && (
            <aside className={`${st.side} ${st.right}`}>
              {selBlock ? (
                <Inspector key={selBlock.id} b={selBlock} set={(p) => setBlock(selBlock.id, p)} projectId={id} onImage={(f) => void imageInto(f, selBlock.id)} />
              ) : (
                <p className={st.hint}>Klick auf einen Baustein in der Liste oder auf der Seite, um ihn hier zu bearbeiten. Bilder kannst du direkt auf die Seite ziehen oder einfügen (Strg+V).</p>
              )}
            </aside>
          )}
        </div>
      )}
      {printing && doc && <PrintDialog doc={doc} title={title} onClose={() => setPrinting(false)} />}
    </ProjectShell>
  );
}

// ---------- rechte Spalte: gewählter Baustein ----------
function Inspector({ b, set, projectId, onImage }: { b: Block; set: (p: Partial<Block>) => void; projectId: number; onImage: (f: Blob) => void }) {
  const rich = (label: string, value: string | undefined, placeholder: string) => (
    <div className="field">
      <label>{label}</label>
      <div className={st.richBox}>
        <RichText value={value ?? ''} onChange={(md) => set({ md })} max={200_000} label={label} tools={['bold', 'italic', 'ul', 'ol']} placeholder={placeholder} tip={false} pinKey="collegare-editor-leiste-blatt" defaultPinned />
      </div>
    </div>
  );
  const ruling = (value: Ruling | undefined, onChange: (r: Ruling) => void, withEmpty = true) => (
    <select value={value ?? 'lines'} onChange={(e) => onChange(e.target.value as Ruling)}>
      <option value="lines">Schreiblinien</option>
      <option value="grid">Karos (Mathe)</option>
      {withEmpty && <option value="empty">Freiraum</option>}
    </select>
  );
  return (
    <section className={st.sec}>
      <div className={st.secHead}>
        {ICON[b.type]} {BLOCK_LABEL[b.type]}
      </div>
      {b.type === 'heading' && (
        <>
          <div className="field">
            <label>Text</label>
            <input value={b.text ?? ''} onChange={(e) => set({ text: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label>Art</label>
            <select value={b.level ?? 2} onChange={(e) => set({ level: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>groß</option>
              <option value={2}>unterstrichen (z. B. „Arbeitsaufträge:“)</option>
            </select>
          </div>
        </>
      )}
      {b.type === 'material' && (
        <>
          <div className={st.grid2}>
            <div className="field">
              <label>Bezeichnung</label>
              <input value={b.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="automatisch: Material 1" />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <label className={st.check}>
                <input type="checkbox" checked={b.lineNumbers !== false} onChange={(e) => set({ lineNumbers: e.target.checked })} /> Zeilen zählen
              </label>
            </div>
          </div>
          <div className="field">
            <label>Titel</label>
            <input value={b.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="z. B. Aus dem Schreiben des Reichsarbeitsministers …" />
          </div>
          {rich('Text', b.md, 'Text des Materials. Jede Zeile ist ein Absatz.')}
          <div className="field">
            <label>Quelle (steht als Fußnote unten auf der Seite)</label>
            <input value={b.source ?? ''} onChange={(e) => set({ source: e.target.value })} placeholder="zitiert nach …" />
          </div>
          <label className={st.check}>
            <input type="checkbox" checked={b.justify !== false} onChange={(e) => set({ justify: e.target.checked })} /> Blocksatz
          </label>
        </>
      )}
      {b.type === 'text' && rich('Text', b.md, 'Erklärtext, Hinweise, Einleitung …')}
      {b.type === 'quote' && (
        <>
          {rich('Zitat', b.md, 'Zitierter Text')}
          <div className="field">
            <label>Quelle</label>
            <input value={b.source ?? ''} onChange={(e) => set({ source: e.target.value })} placeholder="z. B. Hannah Arendt, 1951" />
          </div>
        </>
      )}
      {b.type === 'image' && <ImageFields b={b} set={set} projectId={projectId} onImage={onImage} />}
      {b.type === 'task' && (
        <>
          {rich('Aufgabenstellung', b.md, 'z. B. Geben Sie das Schreiben knapp wieder …')}
          <div className={st.grid2}>
            <div className="field">
              <label>Punkte oder Anteil</label>
              <input value={b.points ?? ''} onChange={(e) => set({ points: e.target.value })} placeholder="z. B. 50% oder 12 P." />
            </div>
            <div className="field">
              <label>Antwortzeilen darunter</label>
              <input type="number" min={0} max={40} value={b.lines ?? 0} onChange={(e) => set({ lines: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} />
            </div>
          </div>
          {(b.lines ?? 0) > 0 && (
            <div className="field">
              <label>Art der Zeilen</label>
              {ruling(b.lineStyle, (r) => set({ lineStyle: r }), false)}
            </div>
          )}
        </>
      )}
      {b.type === 'box' && (
        <>
          <div className="field">
            <label>Titel (optional)</label>
            <input value={b.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder="z. B. Operatoren" />
          </div>
          {rich('Inhalt', b.md, '**aufzeigen, beschreiben** historische Sachverhalte …')}
        </>
      )}
      {b.type === 'lines' && (
        <>
          <div className="field">
            <label>Art</label>
            {ruling(b.style, (r) => set({ style: r }))}
          </div>
          <label className={st.check}>
            <input type="checkbox" checked={!!b.fill} onChange={(e) => set({ fill: e.target.checked })} /> bis zum Seitenende
          </label>
          {!b.fill && (
            <div className="field">
              <label>{b.style === 'grid' ? 'Kästchenreihen' : 'Anzahl Zeilen'}</label>
              <input type="number" min={1} max={60} value={b.count ?? 8} onChange={(e) => set({ count: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
            </div>
          )}
          {b.style !== 'grid' && b.style !== 'empty' && (
            <>
              <div className="field">
                <label>Zeilenabstand</label>
                <select value={b.spacing ?? 8} onChange={(e) => set({ spacing: Number(e.target.value) })}>
                  {[6, 7, 8, 9, 10, 12].map((v) => (
                    <option key={v} value={v}>
                      {v} mm
                    </option>
                  ))}
                </select>
              </div>
              <label className={st.check}>
                <input type="checkbox" checked={!!b.rand} onChange={(e) => set({ rand: e.target.checked })} /> mit Korrekturrand
              </label>
            </>
          )}
        </>
      )}
      {b.type === 'pagebreak' && <p className={st.hint}>Der nächste Baustein beginnt auf einer neuen Seite.</p>}
    </section>
  );
}

/** Bild: Datei, Einfügen, Ziehen oder aus dem Material von Collegare (Bilder dieses Projekts bzw. der Werkstatt) */
function ImageFields({ b, set, projectId, onImage }: { b: Block; set: (p: Partial<Block>) => void; projectId: number; onImage: (f: Blob) => void }) {
  const [pick, setPick] = useState<Material[] | null>(null);
  const [err, setErr] = useState('');
  async function openPick() {
    setErr('');
    try {
      const r = await get<{ materials: Material[] }>(`/api/projects/${projectId}/materials`);
      setPick(r.materials.filter((m) => (m.mime ?? '').startsWith('image/')));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function take(m: Material) {
    const res = await fetch(fileUrl(projectId, m.id), { credentials: 'include' });
    if (!res.ok) return setErr('Bild nicht erreichbar');
    onImage(await res.blob());
    if (!b.caption) set({ caption: m.title });
    setPick(null);
  }
  return (
    <>
      {b.src && <img className={st.preview} src={b.src} alt="" />}
      <div className={st.imgPick}>
        <label className="btn">
          {b.src ? 'Anderes Bild …' : 'Bild auswählen …'}
          <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && onImage(e.target.files[0]), (e.target.value = ''))} />
        </label>
        <button className="btn" onClick={() => (pick ? setPick(null) : void openPick())}>
          Aus dem Material
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      {pick && (pick.length ? (
        <div className={st.thumbs}>
          {pick.map((m) => (
            <button key={m.id} onClick={() => void take(m)} title={m.title}>
              <img src={fileUrl(projectId, m.id)} alt={m.title} />
            </button>
          ))}
        </div>
      ) : (
        <p className={st.hint}>Hier gibt es noch keine Bilder im Material. Bilder lädst du unter „Materialien“ hoch, oder du ziehst sie direkt auf die Seite.</p>
      ))}
      <div className="field">
        <label>Bildunterschrift</label>
        <input value={b.caption ?? ''} onChange={(e) => set({ caption: e.target.value })} placeholder="z. B. Plakat 135 × 99 cm, Berlin 1934" />
      </div>
      <div className="field">
        <label>Breite: {b.width ?? 100} %</label>
        <input type="range" min={20} max={100} step={5} value={b.width ?? 100} onChange={(e) => set({ width: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>Ausrichtung</label>
        <select value={b.align ?? 'center'} onChange={(e) => set({ align: e.target.value as Block['align'] })}>
          <option value="left">links</option>
          <option value="center">Mitte</option>
          <option value="right">rechts</option>
        </select>
      </div>
    </>
  );
}

// ---------- Drucken ----------
interface AgAssessment {
  id: number;
  title: string;
  class: string;
  status: string;
}
interface AgStudent {
  id: number;
  name: string;
}

/**
 * Autogra.fi im selben Browser ansprechen: gleiche Adresse (gleicher Server), Anmeldung per Cookie von Autogra.fi,
 * Schutz gegen fremde Seiten über den Kopf X-Autografi-Request.
 */
async function ag<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    credentials: 'include',
    headers: { 'X-Autografi-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new ApiError(j.error?.message ?? `Autogra.fi antwortet mit Fehler ${res.status}`, res.status);
  return j as T;
}

function PrintDialog({ doc, title, onClose }: { doc: BlattDoc; title: string; onClose: () => void }) {
  const [mode, setMode] = useState<'one' | 'ag'>(doc.page.header.qr !== 'none' ? 'ag' : 'one');
  const [agUrl, setAgUrl] = useState('');
  const [agState, setAgState] = useState<'idle' | 'loading' | 'login' | 'ready' | 'error'>('idle');
  const [agMsg, setAgMsg] = useState('');
  const [tasks, setTasks] = useState<AgAssessment[]>([]);
  const [task, setTask] = useState<number | null>(null);
  const [students, setStudents] = useState<AgStudent[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [printName, setPrintName] = useState(true);
  const [valid, setValid] = useState('freigabe');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sheet = sheetSize(doc);

  useEffect(() => {
    let stored = '';
    try {
      stored = localStorage.getItem('collegare-autografi-url') ?? '';
    } catch {}
    get<{ url: string | null }>('/api/autografi').then(
      (r) => setAgUrl(stored || r.url || `${location.origin}/autografi`),
      () => setAgUrl(stored || `${location.origin}/autografi`),
    );
  }, []);

  const loadTasks = useCallback(async () => {
    const base = agUrl.replace(/\/+$/, '');
    if (!base) return;
    setAgState('loading');
    setAgMsg('');
    try {
      const r = await ag<{ teacher: boolean; assessments: AgAssessment[] }>(base, 'GET', '/api/v1/portal');
      if (!r.teacher) {
        setAgState('login');
        setAgMsg('In Autogra.fi bist du nicht als Lehrkraft angemeldet.');
        return;
      }
      setTasks(r.assessments);
      setAgState('ready');
      try {
        localStorage.setItem('collegare-autografi-url', base);
      } catch {}
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAgState('login');
        setAgMsg('Bitte melde dich in Autogra.fi an (neuer Tab) und versuch es dann noch einmal.');
      } else {
        setAgState('error');
        setAgMsg(e instanceof ApiError && e.status !== 404 ? e.message : 'Unter dieser Adresse ist kein Autogra.fi zu erreichen. Bitte die Adresse prüfen (gleicher Server wie Collegare).');
      }
    }
  }, [agUrl]);
  useEffect(() => {
    if (mode === 'ag' && agUrl && agState === 'idle') void loadTasks();
  }, [mode, agUrl, agState, loadTasks]);

  async function pickTask(aid: number) {
    setTask(aid);
    setErr('');
    try {
      const r = await ag<{ assessment: { pseudonymized: boolean }; students: AgStudent[] }>(agUrl.replace(/\/+$/, ''), 'GET', `/api/v1/assessments/${aid}/access-codes`);
      setStudents(r.students);
      setPicked(new Set(r.students.map((s) => s.id)));
      setPrintName(!r.assessment.pseudonymized);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function run() {
    setErr('');
    setBusy(true);
    try {
      let copies: Copy[] = [{}];
      const d: BlattDoc = structuredClone(doc);
      if (mode === 'ag') {
        if (!task || !picked.size) throw new Error('Bitte eine Aufgabe und mindestens eine Person wählen.');
        const body: Record<string, unknown> = { user_ids: [...picked] };
        if (valid === 'freigabe') body.until = 'freigabe';
        else body.hours = Number(valid);
        const r = await ag<{ items: { user_id: number; name: string; code: string; qr: string }[] }>(agUrl.replace(/\/+$/, ''), 'POST', `/api/v1/assessments/${task}/access-codes`, body);
        const order = new Map(students.map((s, i) => [s.id, i]));
        copies = r.items.sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0)).map((it) => ({ name: it.name, printName, code: it.code, qr: it.qr }));
        if (d.page.header.qr === 'none') d.page.header = { ...d.page.header, show: true, qr: 'first' };
      }
      printCopies(d, copies, title);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${st.dialog}`} role="dialog" aria-label="Drucken">
        <h2>Drucken</h2>
        <div className={st.radio}>
          <label>
            <input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} />
            <span>
              Ein Exemplar zum Kopieren
              <small>ohne QR-Code{doc.page.header.qr !== 'none' ? ' (das Feld für den Code bleibt frei)' : ''}</small>
            </span>
          </label>
          <label>
            <input type="radio" checked={mode === 'ag'} onChange={() => setMode('ag')} />
            <span>
              Für jede Person ein eigenes Exemplar mit QR-Code aus Autogra.fi
              <small>Mit dem Code scannen die Lernenden ihre Seiten mit dem Handy ein, ohne Anmeldung.</small>
            </span>
          </label>
        </div>

        {mode === 'ag' && (
          <>
            {(agState === 'login' || agState === 'error') && (
              <>
                <div className="error">{agMsg}</div>
                <div className="row">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Adresse von Autogra.fi</label>
                    <input value={agUrl} onChange={(e) => setAgUrl(e.target.value)} />
                  </div>
                </div>
                <div className="row">
                  <a className="btn" href={agUrl.replace(/\/+$/, '') + '/portal'} target="_blank" rel="noopener">
                    Autogra.fi öffnen ↗
                  </a>
                  <button className="btn primary" onClick={() => void loadTasks()}>
                    Noch einmal versuchen
                  </button>
                </div>
              </>
            )}
            {agState === 'loading' && <p className="muted">Aufgaben aus Autogra.fi werden geladen …</p>}
            {agState === 'ready' && (
              <>
                <div className="field">
                  <label>Aufgabe in Autogra.fi</label>
                  <select value={task ?? ''} onChange={(e) => void pickTask(Number(e.target.value))}>
                    <option value="" disabled>
                      bitte wählen
                    </option>
                    {tasks.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.class} · {a.title}
                      </option>
                    ))}
                  </select>
                </div>
                {task && (
                  <>
                    <div className="row">
                      <button className="btn" onClick={() => setPicked(new Set(students.map((s) => s.id)))}>
                        Alle
                      </button>
                      <button className="btn" onClick={() => setPicked(new Set())}>
                        Keine
                      </button>
                      <span className="muted">
                        {picked.size} von {students.length} ausgewählt
                      </span>
                    </div>
                    <div className={st.people}>
                      {students.map((s) => (
                        <label key={s.id} className={st.person}>
                          <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(s.id) : new Set([...p].filter((x) => x !== s.id))))} />
                          {s.name}
                        </label>
                      ))}
                      {!students.length && <div className={st.person}>In der Klasse sind noch keine Lernenden eingetragen.</div>}
                    </div>
                    <div className={st.grid2}>
                      <div className="field">
                        <label>Codes gültig</label>
                        <select value={valid} onChange={(e) => setValid(e.target.value)}>
                          <option value="freigabe">solange die Aufgabe freigegeben ist</option>
                          <option value="24">1 Tag</option>
                          <option value="168">7 Tage</option>
                          <option value="336">14 Tage</option>
                        </select>
                      </div>
                      <label className={st.check}>
                        <input type="checkbox" checked={printName} onChange={(e) => setPrintName(e.target.checked)} /> Namen eindrucken
                      </label>
                    </div>
                    <p className={st.hint}>Neue Codes ersetzen ältere nicht; schon verteilte Codes gelten weiter.</p>
                  </>
                )}
              </>
            )}
          </>
        )}

        <p className={st.hint}>
          {doc.page.booklet
            ? `Broschüre auf ${sheet.name}: beidseitig drucken, an der kurzen Kante wenden, Größe 100 % (nicht „an Seite anpassen“). Danach in der Mitte falten.`
            : `Auf ${sheet.name} drucken, Größe 100 % (nicht „an Seite anpassen“).`}{' '}
          Im Druckfenster des Browsers kannst du auch „Als PDF speichern“ wählen.
        </p>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={busy || (mode === 'ag' && (!task || !picked.size))} onClick={() => void run()}>
            {busy ? 'Bereitet vor …' : mode === 'ag' ? `${picked.size} ${picked.size === 1 ? 'Exemplar' : 'Exemplare'} drucken` : 'Drucken'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Alle Exemplare setzen, in Bögen legen und das Druckfenster öffnen. */
function printCopies(doc: BlattDoc, copies: Copy[], title: string) {
  const printHost = document.createElement('div');
  printHost.className = `${st.host} ${st.printHost}`;
  document.body.appendChild(printHost);
  const tmp = document.createElement('div');
  tmp.className = st.host;
  printHost.appendChild(tmp);
  const sheets: Element[] = [];
  for (const c of copies) {
    const r = paginate(doc, tmp, c);
    const out = document.createElement('div');
    toSheets(doc, r.pages, out);
    sheets.push(...out.children);
  }
  tmp.remove();
  printHost.append(...sheets);
  const s = sheetSize(doc);
  const style = document.createElement('style');
  style.textContent = `@page { size: ${s.w}mm ${s.h}mm; margin: 0; }`;
  document.head.appendChild(style);
  document.body.classList.add('bl-printing');
  const oldTitle = document.title;
  document.title = title || 'Arbeitsblatt';
  const done = () => {
    document.body.classList.remove('bl-printing');
    printHost.remove();
    style.remove();
    document.title = oldTitle;
    removeEventListener('afterprint', done);
  };
  addEventListener('afterprint', done);
  // Bilder (QR-Codes) erst laden lassen
  const imgs = [...printHost.querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))).then(() => setTimeout(() => print(), 50));
}
