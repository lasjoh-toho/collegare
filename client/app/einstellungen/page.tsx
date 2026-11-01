'use client';
/**
 * Einstellungsseite je Projekt nach dem Aufbau von Autogra.fi (public/einstellungen.html):
 * Voreinstellungen oben (aktiver Knopf leuchtet), Akkordeons je Thema, ein Speichern-Knopf,
 * Export/Import als JSON, Konfliktschutz über die Revision. Was der Rahmen der Administration
 * nicht zulässt, ist ausgegraut.
 */
import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href, patch } from '@/lib/api';
import type { Frame, ProjectSettings } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import { DOC_LABELS, EXPORT_LABELS, IMPORT_LABELS, PHASE_LABELS } from '@/lib/labels';
import e from './einstellungen.module.css';

interface Page {
  title: string;
  mode: 'group' | 'single';
  settings: ProjectSettings;
  revision: number;
  frame: Frame;
  presets: { id: string; title: string; patch: Partial<ProjectSettings> }[];
}

const toLocal = (ms: number | null) => (ms === null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);

/** Gleicht eine Voreinstellung mit den aktuellen Werten ab (für das Leuchten des Knopfs). */
function matches(s: ProjectSettings, p: Partial<ProjectSettings>): boolean {
  return Object.entries(p).every(([k, v]) => JSON.stringify((s as unknown as Record<string, unknown>)[k]) === JSON.stringify(v));
}

export default function Einstellungen() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [page, setPage] = useState<Page | null>(null);
  const [s, setS] = useState<ProjectSettings | null>(null);
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['project', 'groups']));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = () =>
    get<Page>(`/api/projects/${id}/settings`)
      .then((p) => {
        setPage(p);
        setS(p.settings);
        setTitle(p.title);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));

  useEffect(() => {
    if (Number.isInteger(id)) void load();
  }, [id]);

  const dirty = useMemo(() => !!page && !!s && (JSON.stringify(page.settings) !== JSON.stringify(s) || title !== page.title), [page, s, title]);

  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (dirty) ev.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error && !page)
    return (
      <>
        <Topbar me={me ?? null} />
        <main className={e.main}>
          <div className="error">{error}</div>
        </main>
      </>
    );
  if (!page || !s) return null;
  const f = page.frame;
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setS({ ...s, [k]: v });
  const flag = (k: 'docTypes' | 'importTypes' | 'exportFormats', key: string, v: boolean) => setS({ ...s, [k]: { ...s[k], [key]: v } });

  async function save() {
    setError('');
    try {
      const r = await patch<{ settings: ProjectSettings; revision: number }>(`/api/projects/${id}`, { title: title.trim() || page!.title, settings: s, revision: page!.revision });
      setPage({ ...page!, settings: r.settings, revision: r.revision, title: title.trim() || page!.title });
      setS(r.settings);
      setSaved('Gespeichert');
      setTimeout(() => setSaved(''), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ collegare: 'projekt-einstellungen', version: 1, settings: s }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `collegare-einstellungen-${title.replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file: File) {
    void file.text().then((txt) => {
      try {
        const j = JSON.parse(txt) as { settings?: Partial<ProjectSettings> };
        if (!j.settings) throw new Error('keine Einstellungen in der Datei');
        // Termine gehören zum alten Projekt
        const { choiceDeadline: _d, phases: _p, ...rest } = j.settings;
        setS({ ...s!, ...rest });
        setSaved('Importiert – bitte prüfen und speichern');
      } catch (err) {
        setError('Datei nicht lesbar: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  }

  const toggle = (aid: string) => setOpen((o) => (o.has(aid) ? new Set([...o].filter((x) => x !== aid)) : new Set([...o, aid])));

  return (
    <>
      <Topbar me={me ?? null} title={`Einstellungen · ${page.title}`}>
        <a className="btn" href={href(`/projekt/?id=${id}`)}>
          ← zum Projekt
        </a>
      </Topbar>
      <main className={e.main}>
        <div className={e.presets}>
          {page.presets.map((p) => (
            <button key={p.id} className={`${e.preset} ${matches(s, p.patch) ? e.active : ''}`} onClick={() => setS({ ...s, ...p.patch })} title="Setzt mehrere Einstellungen auf einmal">
              {p.title}
            </button>
          ))}
        </div>

        <AccBox open={open.has('project')} onToggle={toggle} id="project" title="Projekt">
          <div className="field">
            <label>Titel</label>
            <input value={title} onChange={(ev) => setTitle(ev.target.value)} />
          </div>
          <div className="field">
            <label>Leitfrage bzw. Aufgabenstellung (für Lernende sichtbar)</label>
            <textarea rows={4} value={s.brief} onChange={(ev) => set('brief', ev.target.value)} />
          </div>
          <div className="field">
            <label>Fach (für KI-Vorlagen und Dokumentvorlagen)</label>
            <input value={s.subject ?? ''} onChange={(ev) => set('subject', ev.target.value || null)} placeholder="z. B. Geschichte" />
          </div>
        </AccBox>

        <AccBox open={open.has('groups')} onToggle={toggle} id="groups" title="Gruppenbildung" inactive={page.mode === 'single'}>
          {page.mode === 'single' ? (
            <p className="muted">Einzelarbeit: Jede Person hat eine eigene Karte.</p>
          ) : (
            <>
              <div className="field">
                <label>Wer bildet die Gruppen?</label>
                <div className="seg">
                  {(
                    [
                      ['teacher', 'Lehrkraft'],
                      ['choice', 'Lernende wählen'],
                      ['open', 'Lernende wählen und legen an'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={`btn ${s.groupFormation === v ? 'on' : ''}`} onClick={() => set('groupFormation', v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {s.groupFormation !== 'teacher' && (
                <div className={e.grid3}>
                  <div className="field">
                    <label>Mindestens</label>
                    <input type="number" min={1} max={30} value={s.groupMin} onChange={(ev) => set('groupMin', Number(ev.target.value))} />
                  </div>
                  <div className="field">
                    <label>Höchstens je Gruppe</label>
                    <input type="number" min={1} max={30} value={s.groupMax} onChange={(ev) => set('groupMax', Number(ev.target.value))} />
                  </div>
                  <div className="field">
                    <label>Wahl offen bis</label>
                    <input type="datetime-local" value={toLocal(s.choiceDeadline)} onChange={(ev) => set('choiceDeadline', fromLocal(ev.target.value))} />
                  </div>
                </div>
              )}
              <Check label="Lernende dürfen das Thema ihrer Gruppe setzen" checked={s.studentsSetTopic} onChange={(v) => set('studentsSetTopic', v)} />
            </>
          )}
          <div className="field">
            <label>Rollen zur Auswahl (eine je Zeile)</label>
            <textarea rows={4} value={s.roles.join('\n')} onChange={(ev) => set('roles', ev.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20))} />
          </div>
          <Check label="Eigene Rollen erlaubt" checked={s.freeRoles} onChange={(v) => set('freeRoles', v)} />
        </AccBox>

        <AccBox open={open.has('phases')} onToggle={toggle} id="phases" title="Phasen">
          <p className="muted">Wie die Schritte in Autogra.fi: an, zeitgesteuert oder aus. Gruppen können zurückgehen; ein Wechsel wird protokolliert.</p>
          {Object.entries(PHASE_LABELS).map(([k, l]) => {
            const ph = s.phases[k];
            return (
              <div key={k} className={e.phase}>
                <span className={e.phaseName}>{l}</span>
                <div className="seg">
                  {(
                    [
                      ['on', 'an'],
                      ['scheduled', 'zeitgesteuert'],
                      ['off', 'aus'],
                    ] as const
                  ).map(([v, t]) => (
                    <button key={v} className={`btn ${ph.state === v ? 'on' : ''}`} onClick={() => set('phases', { ...s.phases, [k]: { ...ph, state: v } })}>
                      {t}
                    </button>
                  ))}
                </div>
                {ph.state === 'scheduled' && (
                  <>
                    <input className="input" type="datetime-local" value={toLocal(ph.from)} onChange={(ev) => set('phases', { ...s.phases, [k]: { ...ph, from: fromLocal(ev.target.value) } })} aria-label="von" />
                    <input className="input" type="datetime-local" value={toLocal(ph.to)} onChange={(ev) => set('phases', { ...s.phases, [k]: { ...ph, to: fromLocal(ev.target.value) } })} aria-label="bis" />
                  </>
                )}
              </div>
            );
          })}
        </AccBox>

        <AccBox open={open.has('docs')} onToggle={toggle} id="docs" title="Dokumente und Dateien">
          <h4>Was Lernende anlegen dürfen</h4>
          {Object.entries(DOC_LABELS).map(([k, l]) => (
            <Check key={k} label={l} checked={s.docTypes[k]} disabled={f.docTypes[k] === false} onChange={(v) => flag('docTypes', k, v)} />
          ))}
          <h4>Was importiert werden darf</h4>
          <p className="muted">Ein Import gilt wie ein großes Einfügen und steht im Einfüge-Protokoll.</p>
          {Object.entries(IMPORT_LABELS).map(([k, l]) => (
            <Check key={k} label={l} checked={s.importTypes[k]} disabled={f.importTypes[k] === false} onChange={(v) => flag('importTypes', k, v)} />
          ))}
          <h4>Exportformate</h4>
          {Object.entries(EXPORT_LABELS).map(([k, l]) => (
            <Check key={k} label={l} checked={s.exportFormats[k]} disabled={f.exportFormats[k] === false} onChange={(v) => flag('exportFormats', k, v)} />
          ))}
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Höchstgröße je Datei (MB, Rahmen: {f.maxFileMb})</label>
            <input type="number" min={1} max={f.maxFileMb} value={s.maxFileMb} onChange={(ev) => set('maxFileMb', Math.min(Number(ev.target.value), f.maxFileMb))} />
          </div>
        </AccBox>

        <AccBox open={open.has('formula')} onToggle={toggle} id="formula" title="Formeln" inactive={!s.docTypes.formula}>
          <Check label="Lernende dürfen im Formeleditor umformen" checked={s.formulaTransform} onChange={(v) => set('formulaTransform', v)} hint="Seiten tauschen, erweitern, kürzen. Lehrkräfte haben es immer." />
          <Check label="Lernende dürfen im Formeleditor rechnen" checked={s.formulaCalc} onChange={(v) => set('formulaCalc', v)} hint="Taschenrechner. Lehrkräfte haben es immer." />
        </AccBox>

        <AccBox open={open.has('collab')} onToggle={toggle} id="collab" title="Zusammenarbeit">
          <Check label="„Fertig“-Sperre: fertig markierte Karten und Folien kann nur noch die Person selbst ändern" checked={s.finishLock} onChange={(v) => set('finishLock', v)} />
          <div className="field">
            <label>Sperre aufheben darf</label>
            <div className="seg">
              <button className={`btn ${s.reopenBy === 'teacher' ? 'on' : ''}`} onClick={() => set('reopenBy', 'teacher')}>
                nur die Lehrkraft
              </button>
              <button className={`btn ${s.reopenBy === 'group' ? 'on' : ''}`} onClick={() => set('reopenBy', 'group')}>
                die Gruppe mit Zustimmung der Person
              </button>
            </div>
          </div>
        </AccBox>

        <AccBox open={open.has('log')} onToggle={toggle} id="log" title="Protokoll und Logbuch">
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Einfügen protokollieren ab (Zeichen)</label>
            <input type="number" min={20} value={s.pasteThreshold} onChange={(ev) => set('pasteThreshold', Number(ev.target.value))} />
          </div>
          <Check label="Beim Einfügen nach der Herkunft fragen" checked={s.pasteExplain} onChange={(v) => set('pasteExplain', v)} />
          <Check label="Logbuch verpflichtend" checked={s.logbookRequired} onChange={(v) => set('logbookRequired', v)} />
          {f.typingHints === 'off' && <p className="muted">Tippfluss-Hinweise sind von der Administration abgeschaltet.</p>}
        </AccBox>

        <AccBox open={open.has('ai')} onToggle={toggle} id="ai" title="KI" inactive={!f.ai || !s.aiFeedback}>
          <Check label="KI-Feedback für Lernende" checked={s.aiFeedback} disabled={!f.ai} onChange={(v) => set('aiFeedback', v)} hint="Jede Nutzung erscheint automatisch im Logbuch. Keine Namen im Prompt." />
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Anfragen je Person und Tag</label>
            <input type="number" min={0} max={100} value={s.aiDailyLimit} disabled={!f.ai} onChange={(ev) => set('aiDailyLimit', Number(ev.target.value))} />
          </div>
        </AccBox>

        <div className={e.footer}>
          <button className="btn" onClick={exportJson}>
            Einstellungen exportieren
          </button>
          <label className="btn">
            Einstellungen importieren
            <input type="file" accept="application/json,.json" hidden onChange={(ev) => ev.target.files?.[0] && importJson(ev.target.files[0])} />
          </label>
          <span className="grow" />
          {error && <span className="error">{error}</span>}
          {saved && <span className={e.saved}>{saved}</span>}
          <button className="btn primary big" disabled={!dirty} onClick={save}>
            Speichern
          </button>
        </div>
      </main>
    </>
  );
}

// Außerhalb der Seite definiert, damit Eingabefelder beim Tippen nicht neu entstehen und den Fokus verlieren
function AccBox({ id: aid, title: t, inactive, open, onToggle, children }: { id: string; title: string; inactive?: boolean; open: boolean; onToggle: (id: string) => void; children: React.ReactNode }) {
  return (
    <section className={`${e.acc} ${open ? e.open : ''} ${inactive ? e.inactive : ''}`}>
      <button className={e.head} onClick={() => onToggle(aid)} aria-expanded={open}>
        <span className={e.chev}>›</span>
        {t}
      </button>
      {open && <div className={e.body}>{children}</div>}
    </section>
  );
}

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`${e.check} ${disabled ? e.off : ''}`} title={disabled ? 'von der Administration abgeschaltet' : undefined}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(ev) => onChange(ev.target.checked)} />
      <span>
        {label}
        {disabled && <em> – von der Administration abgeschaltet</em>}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
