'use client';
/**
 * Projekt-Übersicht (docs/gestaltung.md, Abschnitt 7): Ist kein Editor offen, zeigt Collegare alle Oberflächen
 * als Kacheln mit Symbol, Name und Zustand. Nicht freigegebene sind gestrichelt mit dem Hinweis, ab wann sie kommen.
 * Lehrkräfte sehen dieselbe Übersicht und oben ihre Knöpfe (Lernende, Zugangscodes, Einstellungen).
 *
 * Geordnet nach der Rolle im Projekt (Wunsch Jo, 14. November 2026): erst Allgemeines, dann je Phase ein Abschnitt in
 * der Reihenfolge des Seitenmenüs. Fährt man im Seitenmenü über eine Phase, leuchten ihre Kacheln auf. Was Lernende
 * (noch) nicht sehen, trägt für die Lehrkraft das Zeichen „nur du“. Den Bereich „Nur für dich“ mit dem Testbereich gibt es
 * nicht mehr (Jo, 20. November 2026): Ausprobieren und Material vorbereiten geht im Portal unter „Werkzeuge“ und
 * „Materialien“; Korrektur und Einstellungen stehen für die Lehrkraft bei „Allgemein“.
 *
 * Jo, 22. November 2026: Mindmap, Cluster, Gruppen und Gliederung stehen in einer Zeile (Phasen 1 bis 3), danach
 * „4 Recherche und Ausarbeitung“ und „5 Präsentation und Publikation“. Die Themen-Mindmap hat keine eigene Kachel:
 * Solange jemand noch keine Gruppe hat, öffnen Mindmap und Cluster die Themen-Mindmap (sobald die Lehrkraft sie freigibt).
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href } from '@/lib/api';
import { OFFICE_VAR, OVERVIEW_SECTIONS, TILES, TOPIC_MAP_PATH, currentPhase, phaseDone, phaseList, phasePath, type DocSummary, type TileDef } from '@/lib/phases';
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
  // Phase, über der die Maus im Seitenmenü steht (Ereignis aus ProjectShell)
  const [hot, setHot] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setHot((e as CustomEvent<string | null>).detail);
    addEventListener('collegare:phase-hover', on);
    return () => removeEventListener('collegare:phase-hover', on);
  }, []);

  const load = useCallback(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`)
      // die Werkstatt der Lehrkraft hat keine Übersicht, ihre Werkzeuge stehen im Portal
      .then((p) => (p.werkstatt ? location.replace(href('/werkzeuge/')) : setProject(p)))
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

  // Mindmap und Cluster: vor der Gruppe die Themen-Mindmap, danach die Mindmap der Gruppe
  const topicPh = phases.find((x) => x.key === 'topic')!;
  const orientPh = phases.find((x) => x.key === 'orientation')!;
  const hasGroup = project.mode === 'single' || (teacher ? project.board.groups.length > 0 : !!project.myGroupId);
  const onTopic = topicPh.state !== 'off' && (!hasGroup || orientPh.state === 'off' || (!teacher && orientPh.state === 'upcoming'));
  const tilePath = (tile: TileDef) => {
    if ((tile.key === 'map' || tile.key === 'cluster') && onTopic) return TOPIC_MAP_PATH + (tile.key === 'cluster' ? '&ansicht=karten' : '&ansicht=aeste');
    return tile.path;
  };

  const status = (tile: TileDef): { kind: 'missing' | 'draft' | 'released' | 'done'; line: string; open: boolean } => {
    const ph = (tile.key === 'map' || tile.key === 'cluster') && onTopic ? topicPh : tile.phase ? phases.find((x) => x.key === tile.phase)! : null;
    if (ph?.state === 'upcoming') return { kind: 'missing', line: `freigegeben ${ph.badge}`, open: teacher && !!tile.path };
    if (!tile.path) return { kind: 'missing', line: 'folgt in einer der nächsten Versionen', open: false };
    if ((tile.key === 'map' || tile.key === 'cluster') && onTopic) {
      const closed = ph?.state === 'closed';
      return { kind: closed ? 'draft' : 'released', open: true, line: closed ? 'Themen-Mindmap, nur lesen' : 'Themen-Mindmap: das Thema gemeinsam umreißen' };
    }
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
    if (ph?.state === 'off' && !((tile.key === 'map' || tile.key === 'cluster') && onTopic)) return false;
    if (tile.docType && !project.settings.docTypes[tile.docType]) return false;
    if (tile.key === 'chat' && project.settings.chatAll === false && (project.settings.chatGroups === false || project.mode !== 'group')) return false;
    return true;
  });

  return (
    <ProjectShell me={me} project={project} where="Übersicht" docs={docs} actions={teacher && <TeacherActions project={project} onChanged={load} />}>
      <div className={t.wrap}>
        {nowInfo && !teacher && (
          <a className={`panel ${t.now}`} href={href(phasePath(now!)?.replace('{id}', String(id)) ?? `/projekt/?id=${id}`)}>
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
        {(() => {
          const card = (tile: TileDef, opts: { bereich?: string; onlyMe?: string } = {}) => {
            const st = status(tile);
            const color = tile.office ? OFFICE_VAR[tile.office] : 'var(--ui-muted)';
            const tp = tilePath(tile);
            const path = tp ? tp.replace('{id}', String(id)) + (opts.bereich ? `&bereich=${opts.bereich}` : '') : '';
            const open = opts.bereich ? !!tile.path : st.open;
            const kind = opts.bereich ? 'released' : st.kind;
            const inner = (
              <>
                <span className={t.icon} style={{ color: kind === 'missing' ? undefined : color }}>
                  <Icon name={tile.icon} size={26} />
                  {kind === 'done' && (
                    <span className={t.tick} title="erledigt">
                      <Icon name="check" size={12} />
                    </span>
                  )}
                </span>
                <span className={t.title}>{tile.title}</span>
                <span className={t.line}>{opts.bereich ? 'Ohne Gruppe ausprobieren, Demo vorbereiten' : st.line}</span>
                {opts.onlyMe && (
                  <span className={t.onlyMe} title={opts.onlyMe}>
                    nur du
                  </span>
                )}
                {!open && kind === 'missing' && tile.path && <Icon name="lock" size={14} className={t.lock} />}
              </>
            );
            const cls = `${t.tile} ${t[kind]} ${opts.onlyMe ? t.hidden : ''}`;
            const style = { '--tile-color': color } as React.CSSProperties;
            const key = tile.key + (opts.bereich ?? '');
            return open ? (
              <a key={key} className={cls} style={style} href={href(path)} data-office={tile.office ?? undefined}>
                {inner}
              </a>
            ) : (
              <div key={key} className={cls} style={style} aria-disabled="true" data-office={tile.office ?? undefined}>
                {inner}
              </div>
            );
          };
          const general = tiles.filter((x) => x.phase === null);
          return (
            <>
              {(general.length > 0 || teacher) && (
                <section className={t.section}>
                  <h2 className={t.head}>Allgemein</h2>
                  <div className={t.grid}>
                    {general.map((x) => card(x))}
                    {teacher && (
                      <>
                        <a className={`${t.tile} ${t.released} ${t.hidden}`} href={href(`/projekt/korrektur/?id=${id}`)}>
                          <span className={t.icon}>
                            <Icon name="check" size={26} />
                          </span>
                          <span className={t.title}>Korrektur</span>
                          <span className={t.line}>Bewerten und Rückmeldung geben</span>
                          <span className={t.onlyMe}>nur du</span>
                        </a>
                        <a className={`${t.tile} ${t.released} ${t.hidden}`} href={href(`/einstellungen/?id=${id}`)}>
                          <span className={t.icon}>
                            <Icon name="gear" size={26} />
                          </span>
                          <span className={t.title}>Einstellungen</span>
                          <span className={t.line}>Phasen, Gruppen, Dokumente, Regeln</span>
                          <span className={t.onlyMe}>nur du</span>
                        </a>
                      </>
                    )}
                  </div>
                </section>
              )}
              {OVERVIEW_SECTIONS.map((sec) => {
                const phs = phases.filter((ph) => sec.phases.includes(ph.key));
                const list = tiles.filter((x) => x.phase && sec.phases.includes(x.phase));
                if (!list.length) return null;
                const isNow = !!now && sec.phases.includes(now);
                const upcoming = (key: string | null) => phs.find((ph) => ph.key === key && ph.state === 'upcoming');
                return (
                  <section key={sec.no} className={`${t.section} ${hot && (sec.phases as string[]).includes(hot) ? t.hot : ''}`} data-phase={sec.phases.join(' ')}>
                    <h2 className={t.head}>
                      <span className={t.no}>{sec.no}</span> {sec.title}
                      {isNow && <span className={t.nowChip}>jetzt dran</span>}
                    </h2>
                    <div className={t.grid}>
                      {list.map((x) => {
                        const ph = teacher ? upcoming((x.key === 'map' || x.key === 'cluster') && onTopic ? 'topic' : x.phase) : undefined;
                        return card(x, ph ? { onlyMe: `Für Lernende ${ph.badge} freigegeben` } : {});
                      })}
                    </div>
                  </section>
                );
              })}
            </>
          );
        })()}
      </div>
    </ProjectShell>
  );
}
