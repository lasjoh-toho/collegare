'use client';
/** Chat als eigene Seite (Kachel „Chat“); dieselbe Leiste lässt sich auf jeder Projektseite rechts zuschalten. */
import { useEffect, useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { get, href } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';

export default function ChatPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
  }, [id]);
  if (!me || !project) return <Topbar me={me ?? null} />;
  return (
    <ProjectShell me={me} project={project} where="Chat" fill>
      <ChatPanel me={me} project={project} wanted={wanted} />
    </ProjectShell>
  );
}
