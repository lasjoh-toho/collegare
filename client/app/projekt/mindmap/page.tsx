'use client';
/**
 * Phase „Orientierung“: Mindmap der Gruppe mit „Gliederung übernehmen“ (Issue #7).
 * Dazu die gemeinsame Themen-Mindmap (Bereich p) vor der Gruppenbildung; eine Gruppe kann sie als Start übernehmen.
 */
import { PasteRulesContext, type PasteRules } from '@/lib/pasteRules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { BranchMap } from '@/components/BranchMap';
import { MindMap, type Person } from '@/components/MindMap';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { Icon } from '@/components/Icon';
import { get, href, projectSocket } from '@/lib/api';
import type { MapCard, MapDim, MapOp, MindMap as MapData, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './mindmap-page.module.css';

/** Standardwerte für Felder, die eine Karte noch nie gesetzt hatte (zum Zurücknehmen einer Änderung). */
function fieldDefault(c: MapCard, k: string): unknown {
  if (k === 'via') return [];
  if (k === 'shape') return c.kind === 'card' && !c.parent ? 'none' : 'rect';
  if (k === 'route') return c.kind === 'card' && !c.parent ? 'curve' : 'metro';
  if (k === 'bend') return 0.5;
  if (k === 'pick') return false;
  return null;
}

/** Gegenoperation(en) zu op auf dem Stand m, oder null, wenn sie sich nicht zurücknehmen lässt. */
function inverse(m: MapData, op: MapOp): MapOp[] | null {
  switch (op.type) {
    case 'add':
      return [{ type: 'remove', ids: [op.card.id] }];
    case 'update': {
      const c = m.cards[op.id];
      if (!c) return null;
      const prev: Record<string, unknown> = {};
      for (const k of Object.keys(op.patch)) prev[k] = (c as unknown as Record<string, unknown>)[k] ?? fieldDefault(c, k);
      return [{ type: 'update', id: op.id, patch: prev as Extract<MapOp, { type: 'update' }>['patch'] }];
    }
    case 'move': {
      const c = m.cards[op.id];
      return c ? [{ type: 'move', id: op.id, x: c.x, y: c.y, parent: c.parent }] : null;
    }
    case 'remove': {
      const gone = op.ids.map((id) => m.cards[id]).filter(Boolean);
      const strip = ({ children: _c, ...rest }: MapCard) => rest;
      // erst Cluster, dann Karten, dann zurückgelöste Karten wieder hinein, dann Pfeile
      const adds: MapOp[] = [...gone.filter((c) => c.kind === 'cluster'), ...gone.filter((c) => c.kind === 'card')].map((c) => ({ type: 'add', card: strip(c) }));
      const moves: MapOp[] = gone.flatMap((c) =>
        c.children.filter((ch) => !op.ids.includes(ch) && m.cards[ch]).map((ch): MapOp => ({ type: 'move', id: ch, x: m.cards[ch].x, y: m.cards[ch].y, parent: c.id })),
      );
      const links: MapOp[] = m.links.filter((l) => op.ids.includes(l.from) || op.ids.includes(l.to)).map((l) => ({ type: 'link', id: l.id, from: l.from, to: l.to }));
      return [...adds, ...moves, ...links];
    }
    case 'link':
      return [{ type: 'unlink', id: op.id }];
    case 'unlink': {
      const l = m.links.find((x) => x.id === op.id);
      return l ? [{ type: 'link', id: l.id, from: l.from, to: l.to }] : null;
    }
    default:
      return null;
  }
}

interface JoinAck {
  ok: boolean;
  error?: string;
  role?: 'teacher' | 'student';
  scopes?: { scope: string; title: string; readOnly?: boolean }[];
  scope?: string | null;
  readOnly?: boolean;
  people?: Person[];
  map?: MapData;
  version?: number;
}

export default function MindmapPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  // erst nach dem Lesen der Adresse gültig (statischer Export)
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const outlineParam = useQuery('gliederung');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Hervorheben: alles kräftig, oder Übernommenes bzw. noch Offenes ausgrauen (Wunsch Jo, 13. November 2026)
  const [dim, setDim] = useState<MapDim>('none');
  // Ansicht: Äste (wie eine klassische Mindmap) oder Karten-Fläche (brausa); gleiche Daten, Wahl je Gerät
  const [view, setView] = useState<'aeste' | 'karten'>('aeste');
  useEffect(() => {
    try {
      if (localStorage.getItem('collegare-mindmap-ansicht') === 'karten') setView('karten');
    } catch {}
  }, []);
  const switchView = (v: 'aeste' | 'karten') => {
    setView(v);
    try {
      localStorage.setItem('collegare-mindmap-ansicht', v);
    } catch {}
  };
  const sock = useRef<Socket | null>(null);
  const version = useRef(0);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;
  const mapRef = useRef<MapData | null>(null);
  mapRef.current = map;
  // Rückgängig/Wiederholen: je Schritt die Gegenoperationen (nur eigene Änderungen, nur in dieser Sitzung)
  const undoStack = useRef<MapOp[][]>([]);
  const redoStack = useRef<MapOp[][]>([]);
  const [hist, setHist] = useState({ u: 0, r: 0 });
  const syncHist = () => setHist({ u: undoStack.current.length, r: redoStack.current.length });
  // geschlossene Erklärblase: gemerkt wird ihr Text, damit ein neuer Text der Lehrkraft wieder erscheint


  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  // Kachel „Gliederung“ öffnet die Mindmap mit aufgeklappter Gliederung
  useEffect(() => {
    if (outlineParam) setOutlineOpen(true);
  }, [outlineParam]);

  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setToast(String(e.message ?? e)));
  }, [id]);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const doJoin = useCallback(
    (sc: string | null) => {
      sock.current?.emit('map:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
        if (!r.ok) return show(r.error ?? 'Kein Zugriff');
        setJoin(r);
        if ((r.scope ?? null) !== scopeRef.current) {
          undoStack.current = [];
          redoStack.current = [];
          syncHist();
        }
        setScope(r.scope ?? null);
        if (r.map) {
          version.current = r.version ?? 0;
          setMap(r.map);
        } else setMap(null);
      });
    },
    [id],
  );

  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    sock.current = so;
    so.on('connect', () => doJoin(scopeRef.current ?? wanted));
    so.on('map', (msg: { projectId: number; scope: string; map: MapData; version: number }) => {
      if (msg.projectId !== id || msg.scope !== scopeRef.current || msg.version <= version.current) return;
      version.current = msg.version;
      setMap(msg.map);
    });
    so.on('connect_error', (e) => show('Verbindung: ' + e.message));
    return () => {
      so.disconnect();
      sock.current = null;
    };
  }, [id, me, doJoin, wanted]);

  const raw = useCallback(
    (op: MapOp) =>
      new Promise<boolean>((resolve) => {
        if (!sock.current?.connected) {
          show('Keine Verbindung zum Server. Bitte kurz warten.');
          return resolve(false);
        }
        sock.current.emit('map:op', { projectId: id, scope: scopeRef.current, op }, (r: { ok: boolean; error?: string; version?: number }) => {
          if (!r.ok) show(r.error ?? 'Änderung fehlgeschlagen');
          resolve(r.ok);
        });
      }),
    [id],
  );

  const send = useCallback(
    // join: gehört zum vorigen Schritt (z. B. Abzweigungen nachführen), ein Strg+Z nimmt beides zurück
    async (op: MapOp, join = false) => {
      const inv = mapRef.current ? inverse(mapRef.current, op) : null;
      const ok = await raw(op);
      const last = undoStack.current[undoStack.current.length - 1];
      if (ok && inv && join && last) {
        undoStack.current[undoStack.current.length - 1] = [...inv, ...last];
        redoStack.current = [];
        syncHist();
      } else if (ok && inv) {
        undoStack.current.push(inv);
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
        syncHist();
      }
      return ok;
    },
    [raw],
  );

  /** Einen Schritt zurück (oder wieder vor): Gegenoperationen senden und deren Gegenteil auf den anderen Stapel legen */
  const step = useCallback(
    async (from: React.MutableRefObject<MapOp[][]>, to: React.MutableRefObject<MapOp[][]>) => {
      const ops = from.current.pop();
      syncHist();
      if (!ops) return;
      const back: MapOp[][] = [];
      for (const op of ops) {
        const inv = mapRef.current ? inverse(mapRef.current, op) : null;
        if (!(await raw(op))) break;
        if (inv) back.unshift(inv);
        // warten, bis der neue Stand da ist, damit die nächste Gegenoperation vom richtigen Stand ausgeht
        await new Promise((r) => setTimeout(r, 60));
      }
      if (back.length) to.current.push(back.flat());
      syncHist();
    },
    [raw],
  );
  const undo = useCallback(() => void step(undoStack, redoStack), [step]);
  const redo = useCallback(() => void step(redoStack, undoStack), [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) (e.preventDefault(), undo());
      else if ((k === 'z' && e.shiftKey) || k === 'y') (e.preventDefault(), redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  function seedFromTopic() {
    if (!confirm('Die Themen-Mindmap als Start für diese Mindmap übernehmen? Danach arbeitet ihr an eurer eigenen Kopie weiter.')) return;
    sock.current?.emit('map:seed', { projectId: id, scope: scopeRef.current }, (r: { ok: boolean; error?: string }) =>
      show(r.ok ? 'Themen-Mindmap übernommen' : (r.error ?? 'Übernehmen fehlgeschlagen')),
    );
  }

  async function takeOutline() {
    if (map?.outline && !confirm('Die Gliederung wurde schon übernommen. Mit dem jetzigen Stand der Cluster neu übernehmen?')) return;
    if (await send({ type: 'outline' })) {
      setOutlineOpen(true);
      show('Gliederung übernommen');
    }
  }

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const people = join?.people ?? [];
  const name = (uid: number) => people.find((x) => x.id === uid)?.name ?? 'unbekannt';
  const isTopic = scope === 'p';
  const canEdit = !join?.readOnly;
  const hasTopic = !!join?.scopes?.some((x) => x.scope === 'p');
  const empty = !!map && Object.keys(map.cards).length === 0;
  // Erklärung hinter dem i-Knopf (früher eine Blase über der Fläche); Text anpassbar durch die Lehrkraft
  const settings = project.settings;
  const helpText = isTopic
    ? canEdit
      ? 'Themen-Mindmap für alle: Hier umreißt ihr gemeinsam das Thema, noch vor den Gruppen. Jede Gruppe kann sie später als Start für ihre eigene Mindmap übernehmen.'
      : 'Themen-Mindmap: Hier umreißt deine Lehrkraft das Thema. Du kannst sie ansehen.'
    : canEdit
      ? view === 'karten'
        ? 'Sammelt Ideen: Doppelklick auf die Fläche oder „+ Karte“ legt eine Karte an. Zieht Zusammengehöriges in einen Cluster. Was in die Arbeit soll, nehmt ihr mit „In die Gliederung“ auf. Strg+Z nimmt zurück.'
        : 'Sammelt Ideen: + am Thema oder Tab. Zeigt sich ein Thema, wird eine Idee „Als Abschnitt“ zum Hauptast; andere Ideen hängt ihr daran. Was in die Arbeit soll, nehmt ihr mit „In die Gliederung“ auf. Strg+Z nimmt zurück.'
      : 'Hier seht ihr die Mindmap der Gruppe.';
  const info = isTopic ? { key: 'mindmap-topic', title: 'Themen-Mindmap', text: helpText, start: true } : { key: 'mindmap', title: 'Mindmap der Gruppe', text: helpText, start: true };
  const center = isTopic ? project.title : join?.scopes?.find((x) => x.scope === scope)?.title || project.title;

  const pasteRules: PasteRules | null = scope && !isTopic ? { projectId: project.id, scope, outside: settings.pasteOutside, threshold: settings.pasteThreshold } : null;

  return (
    <PasteRulesContext.Provider value={pasteRules}>
      <ProjectShell
        me={me}
        project={project}
        where={outlineOpen ? 'Mindmap und Gliederung' : 'Mindmap'}
        phase={isTopic ? 'topic' : 'orientation'}
        fill
        info={info}
        actions={
          <>
            {join?.scopes && join.scopes.length > 1 && (
              <select className={s.scope} value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} title="Welche Mindmap?">
                {join.scopes.map((x) => (
                  <option key={x.scope} value={x.scope}>
                    {x.title}
                  </option>
                ))}
              </select>
            )}
            {map && (
              <>
                <span className="seg" role="group" aria-label="Ansicht">
                  <button className={`btn ${view === 'aeste' ? 'on' : ''}`} onClick={() => switchView('aeste')} aria-pressed={view === 'aeste'} title="Äste: Thema in der Mitte">
                    <Icon name="map" size={14} /> <span className={s.long}>Äste</span>
                  </button>
                  <button className={`btn ${view === 'karten' ? 'on' : ''}`} onClick={() => switchView('karten')} aria-pressed={view === 'karten'} title="Karten frei auf der Fläche">
                    <Icon name="grid" size={14} /> <span className={s.long}>Karten</span>
                  </button>
                </span>
                {!isTopic && (
                  <>
                    <select className={s.scope} value={dim} onChange={(e) => setDim(e.target.value as MapDim)} title="Was soll kräftig erscheinen?" aria-label="Hervorheben">
                      <option value="none">Alles kräftig</option>
                      <option value="picked">Offenes hervorheben</option>
                      <option value="open">Übernommenes hervorheben</option>
                    </select>
                    <button className={`btn ${outlineOpen ? 'on' : ''}`} onClick={() => setOutlineOpen((o) => !o)}>
                      Gliederung {map.outline ? `(${map.outline.sections.length})` : ''}
                    </button>
                    <button className="btn primary" onClick={takeOutline} title="Übernommenes wird zu Abschnitten">
                      <span className={s.long}>Gliederung </span>übernehmen
                    </button>
                  </>
                )}
              </>
            )}
          </>
        }
      >
        <div className={s.area}>
          {join && !scope && (
            <div className={`panel ${s.notice}`}>
              {teacher ? 'Noch keine Gruppen. Bilde zuerst die Gruppen auf dem Board.' : 'Du bist noch keiner Gruppe zugeordnet. Sobald die Gruppen stehen, erscheint hier eure Mindmap.'}
            </div>
          )}
          <div className={s.notes}>
            {!isTopic && empty && hasTopic && canEdit && (
              <div className={`panel ${s.banner}`}>
                Eure Mindmap ist noch leer.
                <button className="btn primary" onClick={seedFromTopic}>
                  Mit der Themen-Mindmap beginnen
                </button>
              </div>
            )}
          </div>
          {map && canEdit && (
            <div className={s.history}>
              <button className="btn icon" onClick={undo} disabled={!hist.u} title="Rückgängig (Strg+Z)" aria-label="Rückgängig">
                ↶
              </button>
              <button className="btn icon" onClick={redo} disabled={!hist.r} title="Wiederholen (Strg+Y)" aria-label="Wiederholen">
                ↷
              </button>
            </div>
          )}
          {map && view === 'karten' && <MindMap key={scope} map={map} people={people} canEdit={canEdit} send={send} dim={isTopic ? 'none' : dim} />}
          {map && view === 'aeste' && <BranchMap key={scope} map={map} topic={center} people={people} canEdit={canEdit} send={send} dim={isTopic ? 'none' : dim} />}
          {map && outlineOpen && !isTopic && (
            <aside className={s.outline}>
              <div className="row">
                <h3>Gliederung</h3>
                <span className="grow" />
                <button className="btn icon" onClick={() => setOutlineOpen(false)} title="Schließen">
                  ×
                </button>
              </div>
              {!map.outline ? (
                <p className="muted">
                  Noch nicht übernommen. Wählt einen Hauptast (in der Karten-Ansicht: einen Cluster) und tippt „In die Gliederung“, für Unterpunkte ebenso bei den Karten. Nicht alles muss hinein, und
                  Zuständige sind freiwillig. Mit „Hervorheben“ seht ihr, was schon drin ist. Tippt dann auf „Gliederung übernehmen“.
                </p>
              ) : (
                <>
                  <p className="muted">
                    Übernommen am{' '}
                    {new Date(map.outline.at).toLocaleString('de-DE', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                    . Die Abschnitte werden in der Ausarbeitung zu Dokumenten.
                  </p>
                  <ol className={s.sections}>
                    {map.outline.sections.map((sec) => (
                      <li key={sec.id}>
                        <strong>{map.cards[sec.id]?.title || sec.title}</strong>
                        <ul>
                          {sec.cards
                            .filter((c) => map.cards[c])
                            .map((c) => (
                              <li key={c}>{map.cards[c].title || 'Ohne Titel'}</li>
                            ))}
                        </ul>
                        <span className={s.owners}>{sec.owners.length ? sec.owners.map(name).join(', ') : 'noch niemand zuständig'}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </aside>
          )}
        </div>
        {toast && <div className={p.toast}>{toast}</div>}
      </ProjectShell>
    </PasteRulesContext.Provider>
  );
}
