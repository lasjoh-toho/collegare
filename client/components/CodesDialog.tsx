'use client';
/**
 * Zugangscodes wie im Autogra.fi-Portal: Personen auswählen, Gültigkeit wählen, Zettel mit QR-Code
 * und 6-stelligem Code drucken. Die Codes stehen nur in diesem Dialog; der Server speichert Hashes.
 * Gültigkeit (Wunsch Jo, 21. November 2026, wie in Autogra.fi): feste Dauer, „bis zu einer Uhrzeit …“ oder
 * „solange das Projekt freigegeben ist“; dann folgt das Ende den Freigaben der Phasen in den Einstellungen.
 */
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import type { BoardMember } from '@/lib/types';
import c from './codes.module.css';

interface Issued {
  userId: number;
  name: string;
  code: string;
  url: string;
  expiresAt: number;
  followRelease: boolean;
  qr?: string;
}

/** Gewählte Gültigkeit: Tage als Zahl, 'until' (Datum und Uhrzeit) oder 'release' (solange freigegeben) */
type Valid = string;
const VALID_KEY = 'cg.codeValid';
const DAY_OPTIONS: [string, string][] = [
  ['1', '1 Tag'],
  ['7', '1 Woche'],
  ['14', '2 Wochen'],
  ['28', '4 Wochen'],
  ['60', '60 Tage'],
];

const pad = (n: number) => String(n).padStart(2, '0');
/** Wert für datetime-local in Ortszeit */
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Vorschlag: in zwei Stunden, auf die Viertelstunde gerundet (wie in Autogra.fi) */
const defaultUntil = () => {
  const q = 15 * 60_000;
  return toLocalInput(Math.ceil((Date.now() + 2 * 3600_000) / q) * q);
};
const fmtUntil = (ms: number) => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtShort = (ms: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${time}`;
};

export function CodesDialog({
  projectId,
  title,
  members,
  validUntil,
  followRelease,
  onClose,
}: {
  projectId: number;
  title: string;
  members: BoardMember[];
  validUntil?: Record<number, number>;
  followRelease?: number[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set(members.filter((m) => !validUntil?.[m.userId]).map((m) => m.userId)));
  const [valid, setValid] = useState<Valid>('14');
  const [until, setUntil] = useState(defaultUntil);
  const following = new Set(followRelease ?? []);

  // Zuletzt gewählte Gültigkeit merken (nur Bequemlichkeit, je Browser)
  useEffect(() => {
    try {
      const v = localStorage.getItem(VALID_KEY);
      if (v && (v === 'until' || v === 'release' || DAY_OPTIONS.some(([k]) => k === v))) setValid(v);
    } catch {
      /* ohne Speicher: Standard */
    }
  }, []);
  function choose(v: Valid) {
    setValid(v);
    try {
      localStorage.setItem(VALID_KEY, v);
    } catch {
      /* egal */
    }
  }
  const [issued, setIssued] = useState<Issued[] | null>(null);
  const [redeemUrl, setRedeemUrl] = useState('');
  const [error, setError] = useState('');

  async function issue() {
    setError('');
    try {
      const body: Record<string, unknown> = { userIds: [...picked] };
      if (valid === 'release') body.release = true;
      else if (valid === 'until') {
        const ms = new Date(until).getTime();
        if (!until || Number.isNaN(ms) || ms <= Date.now()) return setError('Bitte ein Ende in der Zukunft wählen.');
        body.until = ms;
      } else body.days = Number(valid);
      const r = await post<{ codes: Issued[]; redeemUrl: string }>(`/api/projects/${projectId}/access-codes`, body);
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
              <select className="input" value={valid} onChange={(e) => choose(e.target.value)}>
                {DAY_OPTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
                <option value="until">bis zu einer Uhrzeit …</option>
                <option value="release">solange das Projekt freigegeben ist</option>
              </select>
              {valid === 'until' && <input className="input" type="datetime-local" value={until} min={toLocalInput(Date.now())} onChange={(e) => setUntil(e.target.value)} aria-label="Gültig bis" />}
            </div>
            {valid === 'release' && (
              <p className="muted">Das Ende folgt den Freigaben der Phasen in den Einstellungen und passt sich beim Speichern an. Ist eine Phase ohne Ende offen, gilt der Code bis zu 180 Tage.</p>
            )}
            <div className={c.list}>
              {members.map((m) => (
                <label key={m.userId} className={c.item}>
                  <input type="checkbox" checked={picked.has(m.userId)} onChange={() => toggle(m.userId)} />
                  <span className="grow">{m.name}</span>
                  {validUntil?.[m.userId] && (
                    <span className="chip">
                      bis {fmtShort(validUntil[m.userId])}
                      {following.has(m.userId) ? ' (Freigabe)' : ''}
                    </span>
                  )}
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
                    <div className={c.slipHint}>{x.followRelease ? `gültig, solange das Projekt freigegeben ist (zurzeit bis ${fmtUntil(x.expiresAt)})` : `gültig bis ${fmtUntil(x.expiresAt)}`}</div>
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
