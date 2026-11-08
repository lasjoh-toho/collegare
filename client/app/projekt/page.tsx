'use client';
/**
 * Projekt-Übersicht (docs/gestaltung.md, Abschnitt 7): Ist kein Editor offen, zeigt Collegare alle Oberflächen
 * als Kacheln mit Symbol, Name und Zustand. Nicht freigegebene sind gestrichelt mit dem Hinweis, ab wann sie kommen.
 * Lehrkräfte sehen dieselbe Übersicht und oben ihre Knöpfe (Lernende, Zugangscodes, Einstellungen).
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href } from '@/lib/api';
import { OFFICE_VAR, TILES, currentPhase, phaseDone, phaseList, type DocSummary, type TileDef } from '@/lib/phases';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import { TeacherActions } from './TeacherActions';
import p from './projekt.module.css';
import t from './tiles.module.css';

export default function Projekt() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [docs, setDocs] = useState<DocSummary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`)
      .then(setProject)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    // Zustand der Kacheln (Gliederung übernommen, Abschnitte fertig); ohne Gruppe einfach leer
    get<DocSummary>(`/api/projects/${id}/documents`).then(setDocs, () => setDocs(null));
  }, [id]);

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(load, [load]);

  if (error)
    return (
      <>
        <Topbar me={me ?? null} />
        <main className={p.main}>
          <div className="error">{error}</div>
        </main>
      </>
    );
  if (!project || !me) return null;
  const teacher = project.role === 'teacher';
  const phases = phaseList(project.settings, project.mode === 'single');
  const now = currentPhase(phases, phaseDone(project, me.id, docs));
  const nowInfo = phases.find((x) => x.key === now);
  const myGroup = project.board.groups.find((g) => g.id === project.myGroupId);

  const status = (tile: TileDef): { kind: 'missing' | 'draft' | 'released' | 'done'; line: string; open: boolean } => {
    const ph = tile.phase ? phases.find((x) => x.key === tile.phase)! : null;
    if (ph?.state === 'upcoming') return { kind: 'missing', line: `freigegeben ${ph.badge}`, open: teacher && !!tile.path };
    if (!tile.path) return { kind: 'missing', line: 'folgt in einer der nächsten Versionen', open: false };
    const closed = ph?.state === 'closed';
    const base = { kind: (closed ? 'draft' : 'released') as 'draft' | 'released', open: true };
    switch (tile.key) {
      case 'groups':
        if (teacher) return { ...base, line: `${project.board.members.length} Lernende, ${project.board.groups.length} Gruppen` };
        if (myGroup) return { ...base, kind: 'done', line: `Du bist in „${myGroup.title}“` };
        return { ...base, line: project.settings.groupFormation === 'teacher' ? 'Die Lehrkraft teilt ein' : 'Wähle deine Gruppe' };
      case 'outline':
        if (docs?.outlineAt) return { ...base, kind: 'done', line: `übernommen am ${new Date(docs.outlineAt).toLocaleDateString('de-DE')}` };
        return { ...base, line: 'noch nicht übernommen' };
      case 'sections': {
        const list = teacher ? (docs?.docs ?? []) : (docs?.docs ?? []).filter((d) => d.ownerId === me.id || d.ownerId === null);
        if (!list.length) return { ...base, line: docs?.outlineAt ? 'Abschnitte noch nicht angelegt' : 'zuerst die Gliederung übernehmen' };
        const done = list.filter((d) => d.doneAt).length;
        const what = teacher ? 'Abschnitten' : 'deinen Abschnitten';
        return { ...base, kind: done === list.length ? 'done' : base.kind, line: `${done} von ${list.length} ${what} fertig` };
      }
    }
    return { ...base, line: closed ? 'Phase beendet, nur lesen' : tile.sub };
  };

  const tiles = TILES.filter((tile) => {
    const ph = tile.phase ? phases.find((x) => x.key === tile.phase) : null;
    if (ph?.state === 'off') return false;
    if (tile.docType && !project.settings.docTypes[tile.docType]) return false;
    return true;
  });

  return (
    <ProjectShell me={me} project={project} where="Übersicht" docs={docs} actions={teacher && <TeacherActions project={project} onChanged={load} />}>
      <div className={t.wrap}>
        {nowInfo && !teacher && (
          <a className={`panel ${t.now}`} href={href(TILES.find((x) => x.phase === now && x.path)?.path?.replace('{id}', String(id)) ?? `/projekt/?id=${id}`)}>
            <span className={t.nowIcon}>
              <Icon name={nowInfo.icon} size={22} />
            </span>
            <span className={t.nowText}>
              <span className={t.nowLabel}>Jetzt dran: {nowInfo.title}</span>
              <span>{nowInfo.help}</span>
            </span>
            <Icon name="arrow" size={18} className={t.nowArrow} />
          </a>
        )}
        {teacher && project.board.members.length === 0 && (
          <div className={`notice ${t.hint}`}>Noch keine Lernenden. Trage sie oben mit „+ Lernende“ ein oder übernimm sie aus Moodle.</div>
        )}
        <div className={t.grid}>
          {tiles.map((tile) => {
            const st = status(tile);
            const color = tile.office ? OFFICE_VAR[tile.office] : 'var(--ui-muted)';
            const inner = (
              <>
                <span className={t.icon} style={{ color: st.kind === 'missing' ? undefined : color }}>
                  <Icon name={tile.icon} size={26} />
                  {st.kind === 'done' && (
                    <span className={t.tick} title="erledigt">
                      <Icon name="check" size={12} />
                    </span>
                  )}
                </span>
                <span className={t.title}>{tile.title}</span>
                <span className={t.line}>{st.line}</span>
                {!st.open && st.kind === 'missing' && tile.path && <Icon name="lock" size={14} className={t.lock} />}
              </>
            );
            const cls = `${t.tile} ${t[st.kind]}`;
            const style = { '--tile-color': color } as React.CSSProperties;
            return st.open ? (
              <a key={tile.key} className={cls} style={style} href={href(tile.path!.replace('{id}', String(id)))} data-office={tile.office ?? undefined}>
                {inner}
              </a>
            ) : (
              <div key={tile.key} className={cls} style={style} aria-disabled="true" data-office={tile.office ?? undefined}>
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </ProjectShell>
  );
}
