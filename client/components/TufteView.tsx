'use client';
/** Anzeige einer Lernseite im Tufte-Stil (Markdown aus lib/tufte.ts, dort maskiert). */
import { useMemo } from 'react';
import { renderTufte } from '@/lib/tufte';
import t from './tufte.module.css';

export function TufteView({ title, subtitle, body }: { title: string; subtitle?: string; body: string }) {
  const html = useMemo(() => renderTufte(body), [body]);
  return (
    <article className={t.t}>
      <h1>{title}</h1>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
