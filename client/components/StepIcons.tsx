'use client';
/**
 * Schritte eines Projekts als quadratische Symbole auf der Projektkarte (Wunsch Jo, nach Autogra.fi): vorgesehene
 * Schritte erscheinen, die gerade offenen farbig, die anderen grau. Die Lehrkraft legt direkt hier fest, welche
 * Schritte vorgesehen sind (nur die erscheinen im Seitenmenü der Lernenden), ob sie offen oder geschlossen sind
 * oder in welchem Zeitraum.
 */
import { useEffect, useRef, useState } from 'react';
import { patch } from '@/lib/api';
import { PHASE_ORDER, fmtDay, phaseList } from '@/lib/phases';
import type { PhaseSetting, ProjectSettings } from '@/lib/types';
import { Icon } from './Icon';
import st from './steps.module.css';

type Phases = ProjectSettings['phases'];
const toLocal = (ms: number | null) => (ms === null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);
const SETTINGS = { groupFormation: 'teacher', groupMin: 2, groupMax: 4, choiceDeadline: null, finishLock: true, docTypes: {} } as unknown as ProjectSettings;

export function StepIcons({ projectId, phases, editable, small = false, onChange }: { projectId: number; phases: Phases; editable: boolean; small?: boolean; onChange?: (p: Phases) => void }) {
  const [cur, setCur] = useState<Phases>(phases);
  useEffect(() => setCur(phases), [phases]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = phaseList({ ...SETTINGS, phases: cur }, false);

  // Feste Position am Bildschirm: in der Tabelle würde der Rahmen mit overflow das Fenster sonst abschneiden
  useEffect(() => {
    if (!open || !box.current) return setPos(null);
    const r = box.current.getBoundingClientRect();
    const w = Math.min(460, innerWidth - 24);
    setPos({ top: r.bottom + 6, left: Math.max(12, Math.min(r.left, innerWidth - w - 12)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    addEventListener('scroll', close, true);
    return () => removeEventListener('scroll', close, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', down);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('pointerdown', down);
      removeEventListener('keydown', key);
    };
  }, [open]);

  async function set(key: string, ph: PhaseSetting) {
    const next = { ...cur, [key]: ph };
    setCur(next);
    setErr('');
    try {
      await patch(`/api/projects/${projectId}`, { settings: { phases: next } });
      onChange?.(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      setCur(cur);
    }
  }

  const shown = list.filter((p) => p.state !== 'off');
  return (
    <div className={`${st.wrap} ${small ? st.small : ''}`} ref={box}>
      <div className={st.icons}>
        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${st.icon} ${p.state === 'open' ? st.open : st.grey}`}
            title={`${p.title}: ${p.badge}`}
            aria-label={`${p.title}: ${p.badge}`}
            onClick={(e) => {
              e.preventDefault();
              if (editable) setOpen((o) => !o);
            }}
            disabled={!editable}
          >
            <Icon name={p.icon} size={small ? 13 : 15} />
          </button>
        ))}
        {!shown.length && <span className="muted">keine Schritte vorgesehen</span>}
        {editable && (
          <button type="button" className={`btn icon ${st.edit}`} onClick={() => setOpen((o) => !o)} title="Schritte festlegen" aria-label="Schritte festlegen" aria-expanded={open}>
            <Icon name="gear" size={13} />
          </button>
        )}
      </div>
      {open && (
        <div className={`panel ${st.pop}`} role="dialog" aria-label="Schritte" style={pos ?? undefined}>
          <div className={st.popHead}>Schritte für die Lernenden</div>
          {PHASE_ORDER.map(({ key, title, icon }) => {
            const ph: PhaseSetting = cur[key] ?? { state: 'on', from: null, to: null };
            const info = list.find((x) => x.key === key)!;
            const planned = ph.state !== 'off';
            return (
              <div key={key} className={`${st.row} ${planned ? '' : st.off}`}>
                <label className={st.name} title="Vorgesehen: erscheint im Seitenmenü der Lernenden">
                  <input type="checkbox" checked={planned} onChange={(e) => void set(key, { ...ph, state: e.target.checked ? 'on' : 'off' })} />
                  <span className={`${st.icon} ${st.mini} ${info.state === 'open' ? st.open : st.grey}`}>
                    <Icon name={icon} size={12} />
                  </span>
                  {title}
                </label>
                {planned && (
                  <span className="seg">
                    {(
                      [
                        ['on', 'offen'],
                        ['closed', 'zu'],
                        ['scheduled', 'Zeitraum'],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} type="button" className={`btn ${ph.state === v ? 'on' : ''}`} onClick={() => void set(key, { ...ph, state: v })}>
                        {l}
                      </button>
                    ))}
                  </span>
                )}
                {planned && ph.state === 'scheduled' && (
                  <span className={st.dates}>
                    <input type="datetime-local" value={toLocal(ph.from)} onChange={(e) => void set(key, { ...ph, from: fromLocal(e.target.value) })} aria-label={`${title} ab`} title="ab" />
                    <span className="muted">–</span>
                    <input type="datetime-local" value={toLocal(ph.to)} onChange={(e) => void set(key, { ...ph, to: fromLocal(e.target.value) })} aria-label={`${title} bis`} title="bis" />
                  </span>
                )}
                {planned && ph.state === 'scheduled' && (ph.from || ph.to) && (
                  <small className="muted">
                    {ph.from ? `ab ${fmtDay(ph.from)}` : ''} {ph.to ? `bis ${fmtDay(ph.to)}` : ''}
                  </small>
                )}
              </div>
            );
          })}
          {err && <p className={st.err}>{err}</p>}
        </div>
      )}
    </div>
  );
}
