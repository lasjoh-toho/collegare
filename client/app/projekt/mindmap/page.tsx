'use client';
/**
 * Phase „Orientierung“: Mindmap der Gruppe mit „Gliederung übernehmen“ (Issue #7).
 * Dazu die gemeinsame Themen-Mindmap (Bereich p) vor der Gruppenbildung; eine Gruppe kann sie als Start übernehmen.
 */
import { PasteRulesContext, type PasteRules } from '@/lib/pasteRules';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { BranchMap, type LineHook } from '@/components/BranchMap';
import { Gliederung, hoverLineTarget, LinePreview, lineTargetAt, useLineTab } from '@/components/Gliederung';
import { addCard, cardPoint, greyedCards, LINE_COLOR, linesOf, previewRows, removeCard, visibleKinds } from '@/lib/lines';
import { MindMap, type Person } from '@/components/MindMap';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { Icon } from '@/components/Icon';
import { get, href, post, projectSocket } from '@/lib/api';
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
  if (k === 'pick' || k === 'hideText' || k === 'free' || k === 'docked') return false;
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
    case 'lines':
      return [{ type: 'lines', lines: linesOf(m) }];
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
  const [groupNote, setGroupNote] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Hervorheben: alles kräftig, oder Übernommenes bzw. noch Offenes ausgrauen (Wunsch Jo, 13. November 2026)
  const [dim, setDim] = useState<MapDim>('none');
  // Ast bzw. Cluster vorübergehend als Gliederung zeigen
  const [preview, setPreview] = useState<string | null>(null);
  // Ansicht: Äste (wie eine klassische Mindmap) oder Karten-Fläche (brausa); gleiche Daten, Wahl je Gerät
  const [view, setView] = useState<'aeste' | 'karten'>('aeste');
  // Kacheln „Mindmap“ und „Cluster“ geben die Ansicht in der Adresse vor, sonst gilt die zuletzt gewählte
  const viewParam = useQuery('ansicht');
  useEffect(() => {
    if (viewParam === 'karten' || viewParam === 'aeste') return switchView(viewParam);
    try {
      if (localStorage.getItem('collegare-mindmap-ansicht') === 'karten') setView('karten');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam]);
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
  const kinds = visibleKinds(project?.settings.outlineLines, project?.role === 'teacher');
  const [lineTab, setLineTab] = useLineTab(kinds);
  // geschlossene Erklärblase: gemerkt wird ihr Text, damit ein neuer Text der Lehrkraft wieder erscheint


  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  // Kachel „Gliederung“ öffnet die Mindmap mit aufgeklappter Gliederung
  useEffect(() => {
    if (outlineParam) setOutlineOpen(true);
    else
      try {
        // die Gliederung steht neben der Mindmap (Wunsch Jo); auf breiten Bildschirmen offen, sonst wie zuletzt gewählt
        const v = localStorage.getItem('collegare-mindmap-gliederung');
        setOutlineOpen(v ? v === '1' : window.innerWidth >= 1100);
      } catch {}
  }, [outlineParam]);
  const toggleOutline = () =>
    setOutlineOpen((o) => {
      try {
        localStorage.setItem('collegare-mindmap-gliederung', o ? '0' : '1');
      } catch {}
      return !o;
    });

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
  const outlineHelp =
    ' Gliederung (Knopf oben rechts): zwei Linien, rot für die Präsentation, blau für die Ausarbeitung, mit „beides“ nebeneinander. Zieht Äste, Ideen oder Cluster auf einen Punkt oder direkt auf die Linie (dort entsteht ein neuer Kreis). Große Kreise sind Abschnitte, kleine Kreise Unterpunkte, Punkte in der Linie und kurze Striche die dritte und vierte Ebene; mit den Pfeil-Knöpfen rückt ihr ein oder aus. Gestrichelt: nur in der Gliederung, nicht in der Mindmap. Grau in der Mindmap: in der Gliederung ausgeblendet oder entfernt. Das Schloss hält die Gliederung fest. „Als Gliederung“ zeigt einen Ast oder Cluster vorübergehend als Linie. Das Auge oben rechts hebt Offenes oder schon Übernommenes hervor.';
  const helpText = isTopic
    ? canEdit
      ? 'Themen-Mindmap für alle: Hier umreißt ihr gemeinsam das Thema, noch vor den Gruppen. Jede Gruppe kann sie später als Start für ihre eigene Mindmap übernehmen.'
      : 'Themen-Mindmap: Hier umreißt deine Lehrkraft das Thema. Du kannst sie ansehen.'
    : canEdit
      ? view === 'karten'
        ? 'Cluster: Doppelklick auf die Fläche oder „+ Karte“ legt eine Karte an; Doppelklick auf eine Karte schreibt direkt darin. Zieht Zusammengehöriges in einen Cluster, Karten auch in Karten. Zieht ihr eine Karte im Cluster direkt unter den Rand, dockt sie an eine Linie an: Die Punkte stehen dort in voller Breite untereinander und sind zugeklappt; ein Klick auf die Titelleiste klappt auf, ein Klick auf den Anschlusspunkt links löst die Karte wieder. Ein Schatten zeigt, dass eine Karte herausgehoben ist (gewählt oder gezogen). „Text aus“ blendet alle Texte aus; einzelne zeigt ihr danach über „Text zeigen“ an der Karte. Strg+Z nimmt zurück.' + outlineHelp
        : 'Mindmap: + am Thema oder Tab legt eine Idee an, „+ Abschnitt“ einen Hauptast, „+ Frei“ einen freien Knoten ohne Ast (später anbinden oder eigene Ideen daran sammeln, wie ein zweites Zentrum). Doppelklick auf einen Ast setzt einen Zwischenstopp; antippen eines Zwischenstopps legt dort eine Abzweigung an, die Form und Linie des Asts erbt. Langer Druck auf einen Knoten packt seinen Ansatz: an einem anderen Knoten loslassen bindet ihn dort an, weit weg loslassen stellt ihn frei, auf der Gliederung loslassen nimmt ihn dorthin. Strg+Z nimmt zurück.' + outlineHelp
      : 'Hier seht ihr die Mindmap der Gruppe.';
  const info = isTopic ? { key: 'mindmap-topic', title: 'Themen-Mindmap', text: helpText, start: true } : { key: 'mindmap', title: 'Mindmap der Gruppe', text: helpText, start: true };
  const center = isTopic ? project.title : join?.scopes?.find((x) => x.scope === scope)?.title || project.title;

  // Themen-Mindmap: aus einer Idee eine Gruppe machen (Wunsch Jo), nur die Lehrkraft
  const toGroup =
    isTopic && teacher && project.mode === 'group'
      ? async (title: string) => {
          if (project.board.groups.some((g) => g.title.trim().toLowerCase() === title.toLowerCase())) return setGroupNote(`Die Gruppe „${title}“ gibt es schon.`);
          try {
            await post(`/api/projects/${project.id}/groups/viele`, { titles: [title] });
            setGroupNote(`Gruppe „${title}“ angelegt. Die Lernenden ordnest du auf dem Gruppen-Board zu.`);
          } catch (e) {
            setGroupNote(e instanceof Error ? e.message : 'Gruppe konnte nicht angelegt werden');
          }
          setTimeout(() => setGroupNote(''), 5000);
        }
      : undefined;

  // Gliederung neben der Mindmap (Konzept 8h): Umschalten und Ablegen wirken auf die gerade gezeigte Linie
  const lines = map ? linesOf(map) : null;
  const lineHook: LineHook | undefined =
    map && lines && !isTopic
      ? {
          has: (cid) => !!cardPoint(lines, lineTab, cid),
          greyed: greyedCards(lines),
          hover: (x, y) => hoverLineTarget(x, y),
          preview: (cid) => setPreview(cid),
          toggle: (c, whole) => {
            if (!canEdit) return;
            if (lines.locked) return show('Die Gliederung ist gesperrt. Zum Ändern das Schloss in der Gliederung öffnen.');
            const next = cardPoint(lines, lineTab, c.id) && !whole ? removeCard(lines, lineTab, c.id) : addCard(map, lines, lineTab, c, { whole });
            void send({ type: 'lines', lines: next });
            if (!outlineOpen) setOutlineOpen(true);
          },
          drop: (cid, x, y) => {
            const t = lineTargetAt(x, y);
            const c = map.cards[cid];
            if (!t || !c || !canEdit) return false;
            if (lines.locked) {
              show('Die Gliederung ist gesperrt. Zum Ändern das Schloss öffnen.');
              return true;
            }
            void send({ type: 'lines', lines: addCard(map, lines, t.kind, c, { whole: true, target: t.point, after: 'after' in t ? t.after : undefined }) });
            if (t.kind !== lineTab && kinds.length > 1) setLineTab(t.kind);
            return true;
          },
        }
      : undefined;
  const pasteRules: PasteRules | null = scope && !isTopic ? { projectId: project.id, scope, outside: settings.pasteOutside, threshold: settings.pasteThreshold, logAll: settings.pasteLogAll !== false } : null;

  return (
    <PasteRulesContext.Provider value={pasteRules}>
      <ProjectShell
        me={me}
        project={project}
        where={outlineOpen ? 'Mindmap und Gliederung' : 'Mindmap'}
        phase={isTopic ? 'topic' : 'orientation'}
        fill
        info={info}
        center={
          join?.scopes && join.scopes.length > 1 ? (
            <select className={s.scopeCenter} value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} title="Welche Mindmap?" aria-label="Welche Mindmap?">
              {join.scopes.map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.title}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <div className={s.area}>
          <div className={s.map}>
          {join && !scope && (
            <div className={`panel ${s.notice}`}>
              {teacher ? 'Noch keine Gruppen. Bilde zuerst die Gruppen auf dem Board.' : 'Du bist noch keiner Gruppe zugeordnet. Sobald die Gruppen stehen, erscheint hier eure Mindmap.'}
            </div>
          )}
          <div className={s.notes}>
            {groupNote && <div className={`panel ${s.banner}`}>{groupNote}</div>}
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
          {map && (
            <div className={s.viewbar} data-ui onPointerDown={(e) => e.stopPropagation()}>
              {!isTopic && <DimButton dim={dim} onDim={setDim} />}
              <span className="seg" role="group" aria-label="Ansicht">
                <button className={`btn ${view === 'aeste' ? 'on' : ''}`} onClick={() => switchView('aeste')} aria-pressed={view === 'aeste'} title="Mindmap: Thema in der Mitte, Äste">
                  <Icon name="map" size={14} /> <span className={s.long}>Mindmap</span>
                </button>
                <button className={`btn ${view === 'karten' ? 'on' : ''}`} onClick={() => switchView('karten')} aria-pressed={view === 'karten'} title="Cluster: Karten frei auf der Fläche">
                  <Icon name="grid" size={14} /> <span className={s.long}>Cluster</span>
                </button>
              </span>
              {!isTopic && (
                <button className={`btn ${outlineOpen ? 'on' : ''}`} aria-pressed={outlineOpen} onClick={toggleOutline} title="Gliederung rechts neben der Mindmap">
                  <Icon name="outline" size={14} /> <span className={s.long}>Gliederung</span>
                </button>
              )}
            </div>
          )}
          {map && view === 'karten' && <MindMap key={scope} map={map} people={people} canEdit={canEdit} send={send} dim={isTopic ? 'none' : dim} onToGroup={toGroup} line={lineHook} />}
          {map && view === 'aeste' && <BranchMap key={scope} map={map} topic={center} people={people} canEdit={canEdit} send={send} dim={isTopic ? 'none' : dim} onToGroup={toGroup} line={lineHook} />}
            {map && lines && preview && map.cards[preview] && (
              <LinePreview
                rows={previewRows(map, preview)}
                color={LINE_COLOR[lineTab]}
                onClose={() => setPreview(null)}
                taken={!!cardPoint(lines, lineTab, preview)}
                onTake={canEdit && !lines.locked ? () => lineHook?.toggle(map.cards[preview], true) : undefined}
              />
            )}
          </div>
          {map && outlineOpen && !isTopic && (
            <aside className={s.outline} aria-label="Gliederung">
              <Gliederung map={map} send={send} people={people} canEdit={canEdit} meId={me.id} kinds={kinds} tab={lineTab} onTab={setLineTab} show={show} onClose={toggleOutline} bothHref={href(`/projekt/gliederung/?id=${project.id}&bereich=${scope}`)} />
            </aside>
          )}
        </div>
        {toast && <div className={p.toast}>{toast}</div>}
      </ProjectShell>
    </PasteRulesContext.Provider>
  );
}

/** Auge oben rechts: was kräftig erscheint (alles, Offenes oder schon Übernommenes) */
function DimButton({ dim, onDim }: { dim: MapDim; onDim: (d: MapDim) => void }) {
  const [open, setOpen] = useState(false);
  const opts: { key: MapDim; label: string }[] = [
    { key: 'none', label: 'Alles kräftig' },
    { key: 'picked', label: 'Offenes hervorheben' },
    { key: 'open', label: 'Übernommenes hervorheben' },
  ];
  return (
    <span className={s.dimWrap}>
      <button className={`btn icon ${dim !== 'none' ? 'on' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} title={`Hervorheben: ${opts.find((o) => o.key === dim)?.label}`} aria-label="Hervorheben">
        <Icon name="eye" size={15} />
      </button>
      {open && (
        <>
          <span className={s.dimBack} onClick={() => setOpen(false)} />
          <span className={s.dimMenu} role="menu">
            {opts.map((o) => (
              <button key={o.key} role="menuitemradio" aria-checked={dim === o.key} className={`btn ${dim === o.key ? 'on' : ''}`} onClick={() => (onDim(o.key), setOpen(false))}>
                {o.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
