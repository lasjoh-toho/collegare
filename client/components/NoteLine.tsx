'use client';
/**
 * Eigene Linie (Konzept 8e.7): die eigenen Notizen in einer Reihenfolge parallel zur Gliederung, als senkrechte
 * U-Bahn-Linie mit weißen Stationen. Notizen zieht man aus dem Thread auf einen Abschnitt (neue Station) oder auf eine
 * Station (angehängte Karte, z. B. Bildquelle für dieselbe Folie). Angehängte Karten lassen sich mit dem Auge ein- und
 * ausblenden. Die Linie gehört der Person; gespeichert wird bei jeder Änderung (lines:save).
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { isChatDrag, readChatDrop } from '@/lib/chatDrag';
import c from './noteLine.module.css';

export interface LineStation {
  id: string;
  noteId: number;
  section: string | null;
  attached: { noteId: number; visible: boolean }[];
}
export interface Line {
  stations: LineStation[];
}
interface Section {
  id: string;
  title: string;
}
/** was die Linie von einer Notiz braucht */
export interface LineNote {
  id: number;
  kind: string;
  title: string;
  body: string;
}

const label = (n: LineNote | undefined) => (n ? n.title || n.body.split('\n')[0].slice(0, 90) || 'Notiz' : 'Notiz nicht mehr da');
const KIND: Record<string, string> = { note: 'Notiz', source: 'Quelle', link: 'Link', image: 'Bild', data: 'Daten', video: 'Video', audio: 'Audio', hand: 'Handschrift' };
const newId = () => Math.random().toString(36).slice(2, 10);

export function NoteLine({ sock, projectId, scope, notes, show }: { sock: Socket | null; projectId: number; scope: string; notes: LineNote[]; show: (m: string) => void }) {
  const [line, setLine] = useState<Line | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const saving = useRef(0);
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!sock) return;
    sock.emit('lines:get', { projectId, scope }, (r: { ok: boolean; error?: string; line?: Line; sections?: Section[] }) => {
      if (!r.ok) return showRef.current(r.error ?? 'Linie nicht geladen');
      setLine(r.line ?? { stations: [] });
      setSections(r.sections ?? []);
    });
  }, [sock, projectId, scope]);

  function put(next: Line) {
    setLine(next);
    const n = ++saving.current;
    sock?.emit('lines:save', { projectId, scope, line: next }, (r: { ok: boolean; error?: string }) => n === saving.current && !r.ok && show(r.error ?? 'Linie nicht gespeichert'));
  }

  if (!line) return <p className="muted">Linie wird geladen …</p>;

  const known = new Set(sections.map((s) => s.id));
  // Stationen ohne (noch vorhandenen) Abschnitt oben, dann die Abschnitte der Gliederung
  const groups: { id: string | null; title: string }[] = [{ id: null, title: sections.length ? 'Ohne Abschnitt' : 'Meine Linie' }, ...sections];
  const inGroup = (g: string | null) => line.stations.filter((s) => (g === null ? !s.section || !known.has(s.section) : s.section === g));

  const drop = (e: React.DragEvent, onNote: (id: number) => void) => {
    if (!isChatDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const d = readChatDrop(e);
    if (d?.note) onNote(d.note.id);
  };
  const allow = (key: string) => (e: React.DragEvent) => {
    if (!isChatDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (over !== key) setOver(key);
  };

  function addStation(noteId: number, section: string | null) {
    if (line!.stations.some((s) => s.noteId === noteId)) return show('Diese Notiz ist schon eine Station. Zum Anhängen auf eine Station ziehen.');
    // ans Ende des Abschnitts, damit die Reihenfolge der Gliederung erhalten bleibt
    const st: LineStation = { id: newId(), noteId, section, attached: [] };
    const all = [...line!.stations];
    const last = all.map((s, i) => [s, i] as const).filter(([s]) => (section === null ? !s.section || !known.has(s.section) : s.section === section)).pop();
    all.splice(last ? last[1] + 1 : all.length, 0, st);
    put({ stations: all });
  }
  function attach(st: LineStation, noteId: number) {
    if (noteId === st.noteId || st.attached.some((a) => a.noteId === noteId)) return;
    if (st.attached.length >= 20) return show('Höchstens 20 Karten an einer Station.');
    put({ stations: line!.stations.map((s) => (s.id === st.id ? { ...s, attached: [...s.attached, { noteId, visible: true }] } : s)) });
  }
  const patch = (id: string, f: (s: LineStation) => LineStation | null) => put({ stations: line!.stations.flatMap((s) => (s.id === id ? (f(s) ?? []) : [s])) });
  function move(st: LineStation, dir: -1 | 1) {
    const peers = inGroup(st.section && known.has(st.section) ? st.section : null);
    const i = peers.findIndex((s) => s.id === st.id);
    const other = peers[i + dir];
    if (!other) return;
    const all = [...line!.stations];
    const a = all.findIndex((s) => s.id === st.id),
      b = all.findIndex((s) => s.id === other.id);
    [all[a], all[b]] = [all[b], all[a]];
    put({ stations: all });
  }

  return (
    <div className={c.line}>
      <p className={`muted ${c.hint}`}>
        {sections.length
          ? 'Zieh Notizen aus der Liste auf einen Abschnitt, dann werden sie Stationen deiner Linie. Auf eine Station gezogen, hängt eine Karte daran (z. B. ein Bild für dieselbe Folie).'
          : 'Noch keine Gliederung: In der Mindmap Äste „In die Gliederung“ übernehmen, dann erscheinen hier die Abschnitte. Bis dahin sammelst du deine Stationen in einer Linie.'}
      </p>
      {groups.map((g) => {
        const list = inGroup(g.id);
        if (g.id === null && !list.length && sections.length) return null;
        const key = 'g:' + (g.id ?? '');
        return (
          <section key={key} className={c.group}>
            <div className={c.section}>{g.title}</div>
            <div className={c.track}>
              {list.map((st, i) => {
                const n = byId.get(st.noteId);
                const sk = 's:' + st.id;
                return (
                  <div key={st.id} className={`${c.station} ${over === sk ? c.over : ''}`} onDragOver={allow(sk)} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, (id) => attach(st, id))}>
                    <span className={c.stop} aria-hidden />
                    <div className={c.card}>
                      <div className={c.head}>
                        <span className={c.kind}>{n ? KIND[n.kind] ?? n.kind : ''}</span>
                        <strong className={c.title}>{label(n)}</strong>
                        <span className="grow" />
                        <button className="btn icon" disabled={i === 0} onClick={() => move(st, -1)} title="Nach oben" aria-label="Nach oben">
                          ↑
                        </button>
                        <button className="btn icon" disabled={i === list.length - 1} onClick={() => move(st, 1)} title="Nach unten" aria-label="Nach unten">
                          ↓
                        </button>
                        {sections.length > 0 && (
                          <select className={c.move} value={st.section && known.has(st.section) ? st.section : ''} onChange={(e) => patch(st.id, (s) => ({ ...s, section: e.target.value || null }))} aria-label="Abschnitt" title="Zu welchem Abschnitt?">
                            <option value="">Ohne Abschnitt</option>
                            {sections.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                        )}
                        <button className="btn icon" onClick={() => patch(st.id, () => null)} title="Von der Linie nehmen (die Notiz bleibt)" aria-label="Von der Linie nehmen">
                          ×
                        </button>
                      </div>
                      {st.attached.map((a) => {
                        const an = byId.get(a.noteId);
                        return (
                          <div key={a.noteId} className={`${c.attached} ${a.visible ? '' : c.hidden}`}>
                            <button
                              className="btn icon"
                              onClick={() => patch(st.id, (s) => ({ ...s, attached: s.attached.map((x) => (x.noteId === a.noteId ? { ...x, visible: !x.visible } : x)) }))}
                              title={a.visible ? 'Sichtbar: erscheint auf derselben Folie bzw. im selben Absatz. Klicken zum Ausblenden.' : 'Ausgeblendet: bleibt als Beleg dabei. Klicken zum Einblenden.'}
                              aria-label={a.visible ? 'Ausblenden' : 'Einblenden'}
                              aria-pressed={a.visible}
                            >
                              {a.visible ? '👁' : '◌'}
                            </button>
                            <span className={c.kind}>{an ? KIND[an.kind] ?? an.kind : ''}</span>
                            <span className={c.aTitle}>{label(an)}</span>
                            <button className="btn icon" onClick={() => patch(st.id, (s) => ({ ...s, attached: s.attached.filter((x) => x.noteId !== a.noteId) }))} title="Abhängen" aria-label="Abhängen">
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <div className={`${c.dropzone} ${over === key ? c.over : ''}`} onDragOver={allow(key)} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, (id) => addStation(id, g.id))}>
                <span className={c.stopEmpty} aria-hidden />
                {list.length ? 'weitere Notiz hierher ziehen' : 'Notiz hierher ziehen'}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
