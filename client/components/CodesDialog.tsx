'use client';
/**
 * Zugangscodes wie im Autogra.fi-Portal: Personen auswählen, Gültigkeit wählen, Zettel mit QR-Code
 * und 6-stelligem Code drucken. Die Codes stehen nur in diesem Dialog; der Server speichert Hashes.
 */
import QRCode from 'qrcode';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { BoardMember } from '@/lib/types';
import c from './codes.module.css';

interface Issued {
  userId: number;
  name: string;
  code: string;
  url: string;
  expiresAt: number;
  qr?: string;
}

export function CodesDialog({ projectId, title, members, validUntil, onClose }: { projectId: number; title: string; members: BoardMember[]; validUntil?: Record<number, number>; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set(members.filter((m) => !validUntil?.[m.userId]).map((m) => m.userId)));
  const [days, setDays] = useState(14);
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [redeemUrl, setRedeemUrl] = useState('');
  const [error, setError] = useState('');

  async function issue() {
    setError('');
    try {
      const r = await post<{ codes: Issued[]; redeemUrl: string }>(`/api/projects/${projectId}/access-codes`, { userIds: [...picked], days });
      const withQr = await Promise.all(r.codes.map(async (x) => ({ ...x, qr: await QRCode.toDataURL(x.url, { margin: 1, width: 220 }) })));
      setIssued(withQr.sort((a, b) => a.name.localeCompare(b.name, 'de')));
      setRedeemUrl(r.redeemUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revokeAll() {
    if (!confirm('Alle Zugangscodes dieses Projekts sperren? Angemeldete Lernende bleiben angemeldet, bis ihre Sitzung endet.')) return;
    await post(`/api/projects/${projectId}/access-codes/revoke`, {});
    onClose();
  }

  const toggle = (id: number) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${c.modal}`} role="dialog" aria-label="Zugangscodes">
        <h2 className="no-print">Zugangscodes</h2>
        {!issued ? (
          <>
            <p className="muted">Jede Person bekommt einen Zettel mit QR-Code und Code. Ein neuer Code ersetzt den alten nicht; „Alle sperren“ macht alle ungültig.</p>
            <div className="row">
              <button className="btn" onClick={() => setPicked(new Set(members.map((m) => m.userId)))}>
                Alle
              </button>
              <button className="btn" onClick={() => setPicked(new Set())}>
                Keine
              </button>
              <span className="grow" />
              <label className="label">Gültig</label>
              <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 Tag</option>
                <option value={7}>1 Woche</option>
                <option value={14}>2 Wochen</option>
                <option value={28}>4 Wochen</option>
                <option value={60}>60 Tage</option>
              </select>
            </div>
            <div className={c.list}>
              {members.map((m) => (
                <label key={m.userId} className={c.item}>
                  <input type="checkbox" checked={picked.has(m.userId)} onChange={() => toggle(m.userId)} />
                  <span className="grow">{m.name}</span>
                  {validUntil?.[m.userId] && <span className="chip">gültig bis {new Date(validUntil[m.userId]).toLocaleDateString('de-DE')}</span>}
                </label>
              ))}
              {!members.length && <p className="muted">Noch keine Lernenden im Projekt.</p>}
            </div>
            {error && <div className="error">{error}</div>}
            <div className="row">
              <button className="btn danger" onClick={revokeAll}>
                Alle sperren
              </button>
              <span className="grow" />
              <button className="btn" onClick={onClose}>
                Schließen
              </button>
              <button className="btn primary" disabled={!picked.size} onClick={issue}>
                {picked.size} {picked.size === 1 ? 'Code' : 'Codes'} erzeugen
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row no-print">
              <p className="muted grow">Die Codes erscheinen nur jetzt. Drucke die Zettel oder lass die Lernenden den QR-Code abfotografieren.</p>
              <button className="btn" onClick={onClose}>
                Schließen
              </button>
              <button className="btn primary" onClick={() => window.print()}>
                Drucken
              </button>
            </div>
            <div className={c.slips} data-print-root>
              {issued.map((x) => (
                <div key={x.userId} className={c.slip}>
                  {x.qr && <img src={x.qr} alt="" />}
                  <div>
                    <div className={c.slipName}>{x.name}</div>
                    <div className={c.slipProject}>{title}</div>
                    <div className={c.slipCode}>{x.code}</div>
                    <div className={c.slipHint}>QR-Code scannen oder Code eingeben unter {redeemUrl}</div>
                    <div className={c.slipHint}>gültig bis {new Date(x.expiresAt).toLocaleDateString('de-DE')}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
