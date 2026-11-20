'use client';
/**
 * Material zum Einarbeiten (Wunsch Jo, 11. November 2026): Lehrkräfte veröffentlichen Webseiten, Videos, PDFs und
 * Dokumente, auch beim Start aus Moodle. Neues Material ist zuerst nur für die Lehrkraft sichtbar und wird mit
 * „Freigeben“ für die Lernenden sichtbar (Wunsch Jo, 14. November 2026). Videos von YouTube und Vimeo werden
 * eingebettet (YouTube ohne Cookies), PDFs, Bilder und Videodateien im Browser angezeigt, Dokumente heruntergeladen.
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AddForm, AudienceDialog, CopyDialog, MaterialBody, OpenButtons, audienceText, kindLabel, loadTargets, type Material, type Target } from '@/components/Materials';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, del, get, href, patch } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import m from './material.module.css';

export default function MaterialPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [list, setList] = useState<Material[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [forWhom, setForWhom] = useState<Material | null>(null);
  // Übernehmen aus den „Materialien“ (Werkstatt) der Lehrkraft
  const [lib, setLib] = useState<{ werkstatt: number; items: Material[]; targets: Target[] } | null>(null);
  const [notice, setNotice] = useState('');

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  const load = () =>
    get<{ materials: Material[]; canEdit: boolean }>(`/api/projects/${id}/materials`).then((r) => {
      setList(r.materials);
      setCanEdit(r.canEdit);
    }, fail);

  useEffect(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`).then((p) => {
      // die Werkstatt hat ihre eigene Seite im Portal
      if (p.werkstatt) location.replace(href('/materialien/'));
      else setProject(p);
    }, fail);
    void load();
  }, [id]);

  async function move(i: number, d: -1 | 1) {
    if (!list) return;
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setList(next);
    await patch(`/api/projects/${id}/materials/${x.id}`, { order: next.map((y) => y.id) }).catch(fail);
  }

  async function rename(x: Material) {
    const title = prompt('Titel', x.title);
    if (title === null) return;
    const note = prompt('Hinweis für die Lernenden (optional)', x.note);
    await patch(`/api/projects/${id}/materials/${x.id}`, { title, note: note ?? x.note }).then(load, fail);
  }

  async function remove(x: Material) {
    if (!confirm(`„${x.title}“ entfernen?`)) return;
    await del(`/api/projects/${id}/materials/${x.id}`).then(load, fail);
  }

  async function setVisible(x: Material, visible: boolean) {
    await patch(`/api/projects/${id}/materials/${x.id}`, { visible }).then(load, fail);
  }

  async function openLibrary() {
    try {
      const { projectId: w } = await get<{ projectId: number }>('/api/werkstatt');
      const [items, targets] = await Promise.all([get<{ materials: Material[] }>(`/api/projects/${w}/materials`).then((r) => r.materials), loadTargets()]);
      setLib({ werkstatt: w, items, targets });
    } catch (e) {
      fail(e);
    }
  }

  const toggle = (mid: number) => setOpen((o) => (o.has(mid) ? new Set([...o].filter((y) => y !== mid)) : new Set([...o, mid])));

  if (!me || !project) return <Topbar me={me ?? null} />;
  const target: Target = {
    id: project.id,
    title: project.title,
    mode: project.mode,
    groups: project.board.groups.map((g, i) => ({ id: g.id, title: g.title || `Gruppe ${i + 1}` })),
    members: project.board.members.map((x) => ({ id: x.userId, name: x.name, groupId: x.groupId })),
  };
  return (
    <ProjectShell me={me} project={project} where="Material">
      <div className={m.wrap}>
        <header className={m.head}>
          <h1>Material zum Einarbeiten</h1>
          <p className="muted">
            {canEdit
              ? 'Neues Material sehen zuerst nur Lehrkräfte. Erst mit „Freigeben“ sehen es die Lernenden des Projekts, auch beim Start aus Moodle: alle oder nur bestimmte Gruppen und Einzelne („Für wen“).'
              : 'Hier hat deine Lehrkraft Material zusammengestellt, mit dem du dich in das Thema einarbeitest.'}
          </p>
        </header>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {canEdit && !me.projectId && (
          <div className="row">
            <span className="muted">Schon vorbereitet?</span>
            <button className="btn" onClick={openLibrary} title="Material aus deinen Materialien im Portal in dieses Projekt kopieren">
              <Icon name="library" size={15} /> Aus deinen Materialien übernehmen
            </button>
          </div>
        )}
        {canEdit && <AddForm projectId={id} maxMb={project.settings.maxFileMb} onAdded={() => (setError(''), void load())} onError={fail} />}
        {list && list.length === 0 && <p className="muted">{canEdit ? 'Noch kein Material.' : 'Noch kein Material veröffentlicht.'}</p>}
        <ol className={m.list}>
          {list?.map((x, i) => (
            <li key={x.id} className={`panel ${m.item} ${canEdit && !x.visible ? m.hidden : ''}`}>
              <div className={m.row}>
                <span className={m.kind}>{kindLabel(x)}</span>
                <strong className={m.title}>{x.title}</strong>
                {canEdit && (
                  <span className={`chip ${x.visible ? m.shownChip : m.hiddenChip}`} title={x.visible ? 'Die Lernenden sehen dieses Material' : 'Nur Lehrkräfte sehen dieses Material'}>
                    {x.visible ? 'sichtbar' : 'noch unsichtbar'}
                  </span>
                )}
                {canEdit && (
                  <button className={`chip ${m.audChip}`} onClick={() => setForWhom(x)} title="Für wen ist das Material? Alle Lernenden, bestimmte Gruppen oder Einzelne">
                    {audienceText(x.audience, target)}
                  </button>
                )}
                <span className="grow" />
                <OpenButtons projectId={id} x={x} canEdit={canEdit} open={open.has(x.id)} onToggle={() => toggle(x.id)} />
                {canEdit && (
                  <button className={`btn ${x.visible ? '' : 'primary'}`} onClick={() => setVisible(x, !x.visible)} title={x.visible ? 'Wieder unsichtbar für die Lernenden' : 'Für die Lernenden sichtbar machen (alle oder die unter „Für wen“ gewählten)'}>
                    {x.visible ? 'Verbergen' : 'Freigeben'}
                  </button>
                )}
                {canEdit && (
                  <span className={m.tools}>
                    <button className="btn icon" disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben" aria-label="Nach oben">
                      ↑
                    </button>
                    <button className="btn icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Nach unten" aria-label="Nach unten">
                      ↓
                    </button>
                    <button className="btn icon" onClick={() => rename(x)} title="Titel und Hinweis ändern" aria-label="Bearbeiten">
                      <Icon name="pen" size={14} />
                    </button>
                    <button className="btn icon" onClick={() => remove(x)} title="Entfernen" aria-label="Entfernen">
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                )}
              </div>
              {canEdit && (x.tags.length > 0 || x.sourceId) && (
                <div className={m.tags}>
                  {x.sourceId && <span className={m.from}>aus deinen Materialien</span>}
                  {x.tags.map((t) => (
                    <span key={t} className={m.tag}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <MaterialBody projectId={id} x={x} open={open.has(x.id)} />
            </li>
          ))}
        </ol>
      </div>
      {forWhom && (
        <AudienceDialog projectId={id} x={forWhom} target={target} onClose={() => setForWhom(null)} onSaved={() => (setForWhom(null), void load())} onError={fail} />
      )}
      {lib && (
        <CopyDialog
          werkstatt={lib.werkstatt}
          library={lib.items}
          to={target}
          targets={lib.targets}
          onClose={() => setLib(null)}
          onDone={(msg) => (setLib(null), setNotice(msg), void load())}
          onError={fail}
        />
      )}
    </ProjectShell>
  );
}
