'use client';
/**
 * KI-Konfiguration (Wunsch Jo, 24. November 2026): Modellkarten wie in Autogra.fi. Jede Karte ist ein KI-Dienst
 * (Ollama im Schulnetz, OpenAI-kompatibel, Gemini) mit Modell und Verwendungen; bisher nur „Texterkennung“ für
 * „Bild aufnehmen“ in Notizen und Quellen. Bei mehreren Karten mit derselben Verwendung gilt die oberste.
 * Exportieren/Importieren im Format von Autogra.fi, damit die dort eingerichteten Karten übernommen werden können.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, del, get, post, put } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import v from '../verwaltung.module.css';

type CardType = 'ollama' | 'openai' | 'gemini';
interface Card {
  id: string;
  name: string;
  type: CardType;
  url: string;
  model: string;
  description: string;
  region: 'eu' | 'self-hosted' | 'other';
  uses: 'ocr'[];
  think: boolean;
  hasKey: boolean;
}
interface Form {
  id: string | null;
  name: string;
  type: CardType;
  url: string;
  model: string;
  description: string;
  region: Card['region'];
  ocr: boolean;
  think: boolean;
  apiKey: string;
  hasKey: boolean;
}

const TYPES: Record<CardType, { label: string; url: string; hint: string }> = {
  ollama: { label: 'Ollama (Schulnetz)', url: 'http://ollama.schule.local:11434', hint: 'Eigener Rechner im Schulnetz, ohne Schlüssel. Modell mit Bildeingabe, z. B. qwen2.5vl:7b.' },
  openai: { label: 'OpenAI-kompatibel', url: 'https://api.mistral.ai/v1', hint: 'Mistral, vLLM, Azure in der EU und andere mit /chat/completions.' },
  gemini: { label: 'Gemini', url: '', hint: 'Google, braucht einen API-Schlüssel. Region „andere“.' },
};
const REGION: Record<Card['region'], string> = { eu: 'EU', 'self-hosted': 'selbst betrieben', other: 'andere' };
const USES: Record<'ocr', string> = { ocr: 'Texterkennung' };

const blank = (): Form => ({ id: null, name: '', type: 'ollama', url: TYPES.ollama.url, model: '', description: '', region: 'self-hosted', ocr: true, think: false, apiKey: '', hasKey: false });

export default function KiPage() {
  const [me] = useMe();
  const [cards, setCards] = useState<Card[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [probe, setProbe] = useState<Record<string, { busy?: boolean; ok?: boolean; text: string }>>({});
  const file = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  useEffect(() => void get<{ cards: Card[] }>('/api/admin/ki-karten').then((r) => setCards(r.cards), fail), []);

  function edit(c: Card) {
    setError('');
    setForm({
      id: c.id,
      name: c.name,
      type: c.type,
      url: c.url,
      model: c.model,
      description: c.description,
      region: c.region,
      ocr: c.uses.includes('ocr'),
      think: c.think,
      apiKey: '',
      hasKey: c.hasKey,
    });
  }

  async function save() {
    if (!form) return;
    setError('');
    const body = {
      name: form.name,
      type: form.type,
      url: form.url,
      model: form.model,
      description: form.description,
      region: form.region,
      uses: form.ocr ? ['ocr'] : [],
      think: form.think,
      apiKey: form.apiKey,
    };
    try {
      const r = form.id ? await put<{ cards: Card[] }>(`/api/admin/ki-karten/${form.id}`, body) : await post<{ cards: Card[] }>('/api/admin/ki-karten', body);
      setCards(r.cards);
      setForm(null);
    } catch (e) {
      fail(e);
    }
  }

  async function remove(c: Card) {
    if (!confirm(`Karte „${c.name}“ löschen?`)) return;
    try {
      setCards((await del<{ cards: Card[] }>(`/api/admin/ki-karten/${c.id}`)).cards);
    } catch (e) {
      fail(e);
    }
  }

  async function up(c: Card) {
    setCards((await post<{ cards: Card[] }>(`/api/admin/ki-karten/${c.id}/hoch`)).cards);
  }

  async function test(c: Card) {
    setProbe((p) => ({ ...p, [c.id]: { busy: true, text: 'Probeanfrage läuft …' } }));
    try {
      const r = await post<{ ok: boolean; ms?: number; text?: string; error?: string }>(`/api/admin/ki-karten/${c.id}/pruefen`);
      setProbe((p) => ({ ...p, [c.id]: r.ok ? { ok: true, text: `Antwort nach ${((r.ms ?? 0) / 1000).toFixed(1)} s${r.text ? `: „${r.text}“` : ''}` } : { ok: false, text: r.error ?? 'Fehler' } }));
    } catch (e) {
      setProbe((p) => ({ ...p, [c.id]: { ok: false, text: e instanceof Error ? e.message : String(e) } }));
    }
  }

  async function exportCards() {
    const data = await get<{ cards: unknown[] }>('/api/admin/ki-karten/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `modellkarten-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg(`${data.cards.length} ${data.cards.length === 1 ? 'Karte' : 'Karten'} exportiert. API-Schlüssel sind nicht in der Datei.`);
  }

  async function importCards(f: File) {
    setError('');
    setMsg('');
    let d: { format?: string; cards?: { name?: string; type?: string; url?: string; model?: string }[] };
    try {
      d = JSON.parse(await f.text());
    } catch {
      return setError('Die Datei ist kein gültiges JSON.');
    }
    if (d?.format !== 'autografi-modellkarten' || !Array.isArray(d.cards)) return setError('Das ist keine exportierte Konfiguration der Modelle (aus Autogra.fi oder Collegare).');
    // Gemini braucht einen Schlüssel: wie in Autogra.fi nachfragen
    const keys: Record<string, string> = {};
    for (const c of d.cards) {
      if (c.type !== 'gemini' || cards.some((x) => x.name === c.name && x.type === 'gemini')) continue;
      const k = prompt(`API-Schlüssel für „${c.name}“ (Gemini), leer = Karte nicht anlegen:`, '');
      if (k) keys[c.name ?? ''] = k;
    }
    try {
      const r = await post<{ created: number; skipped: number; errors: string[]; cards: Card[] }>('/api/admin/ki-karten/import', { file: d, keys });
      setCards(r.cards);
      setMsg(`${r.created} neu angelegt, ${r.skipped} übersprungen (schon vorhanden oder hier nicht nötig, z. B. LanguageTool).` + (r.errors.length ? ' ' + r.errors.join(' · ') : ''));
    } catch (e) {
      fail(e);
    }
  }

  if (!me) return null;
  const ocrCard = cards.find((c) => c.uses.includes('ocr'));
  return (
    <PortalShell me={me} active="ki">
      <div style={{ maxWidth: 900 }}>
        <PortalHead title="KI-Konfiguration" sub="Modellkarten wie in Autogra.fi. Bisher nutzt Collegare KI für die Texterkennung beim „Bild aufnehmen“ in den Notizen." />
        {error && <div className="error">{error}</div>}
        <section className={`panel ${v.box}`}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <h2 className="grow">Modellkarten ({cards.length})</h2>
            <button className="btn primary" onClick={() => setForm(blank())}>
              + Neue Modellkarte
            </button>
            <button className="btn" onClick={() => void exportCards()} disabled={!cards.length}>
              Exportieren
            </button>
            <button className="btn" onClick={() => file.current?.click()}>
              Importieren
            </button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && void importCards(e.target.files[0]), (e.target.value = ''))} />
          </div>
          {msg && <p className="muted">{msg}</p>}
          <p className="muted">
            Texterkennung: {ocrCard ? <strong>{ocrCard.name}</strong> : <strong style={{ color: 'var(--warn, #b7472a)' }}>noch keine Karte</strong>}
            {cards.filter((c) => c.uses.includes('ocr')).length > 1 && ' (mehrere Karten: die oberste gilt)'}
          </p>
          {form && <CardForm form={form} setForm={setForm} onSave={() => void save()} />}
          {cards.length === 0 && !form && <p className="muted">Noch keine Karte. Am schnellsten: in Autogra.fi unter KI-Konfiguration „Exportieren“ und die Datei hier importieren.</p>}
          {cards.map((c, i) => (
            <div key={c.id} className={v.person} style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <strong>
                  <span style={{ color: c.uses.length ? 'var(--ok)' : 'var(--fg-faint)' }}>●</span> {c.name}
                </strong>
                <small>
                  {TYPES[c.type].label} · {c.model} · Region {REGION[c.region]}
                  {c.type !== 'ollama' && (c.hasKey ? ' · Schlüssel gesetzt' : ' · ohne Schlüssel')}
                </small>
                <small>{c.uses.length ? 'Verwendung: ' + c.uses.map((u) => USES[u]).join(', ') : 'keine Verwendung'}</small>
                {probe[c.id] && <small style={{ color: probe[c.id].busy ? undefined : probe[c.id].ok ? 'var(--ok)' : 'var(--danger, #b42318)' }}>{probe[c.id].text}</small>}
              </div>
              <div className={v.acts}>
                {i > 0 && (
                  <button className="btn" onClick={() => void up(c)} title="Nach oben: gilt dann zuerst">
                    ↑
                  </button>
                )}
                <button className="btn" onClick={() => void test(c)} disabled={probe[c.id]?.busy}>
                  Prüfen
                </button>
                <button className="btn" onClick={() => edit(c)}>
                  Bearbeiten
                </button>
                <button className="btn icon" onClick={() => void remove(c)} title="Löschen" aria-label="Löschen">
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </PortalShell>
  );
}

function CardForm({ form, setForm, onSave }: { form: Form; setForm: (f: Form | null) => void; onSave: () => void }) {
  const set = <K extends keyof Form>(k: K, val: Form[K]) => setForm({ ...form, [k]: val });
  return (
    <div className="panel" style={{ padding: 14, boxShadow: '0 0 0 2px var(--ui-accent, #3f5f8a)' }}>
      <h2 style={{ marginTop: 0 }}>{form.id ? 'Modellkarte bearbeiten' : 'Neue Modellkarte'}</h2>
      <div className={v.grid}>
        <div className="field">
          <label>Name</label>
          <input value={form.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="z. B. Qwen im Schulnetz" />
        </div>
        <div className="field">
          <label>Typ</label>
          <select
            value={form.type}
            onChange={(e) => {
              const t = e.target.value as CardType;
              setForm({
                ...form,
                type: t,
                url: form.url && form.url !== TYPES[form.type].url ? form.url : TYPES[t].url,
                region: t === 'ollama' ? 'self-hosted' : t === 'gemini' ? 'other' : 'eu',
                think: t === 'ollama' && form.think,
              });
            }}
          >
            {(Object.keys(TYPES) as CardType[]).map((t) => (
              <option key={t} value={t}>
                {TYPES[t].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Modell</label>
          <input
            value={form.model}
            maxLength={160}
            onChange={(e) => set('model', e.target.value)}
            placeholder={form.type === 'gemini' ? 'gemini-2.5-flash' : form.type === 'ollama' ? 'qwen2.5vl:7b' : 'pixtral-large-latest'}
          />
        </div>
      </div>
      <p className="muted" style={{ margin: '6px 0' }}>
        {TYPES[form.type].hint}
      </p>
      <div className={v.grid}>
        {form.type !== 'gemini' && (
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Adresse</label>
            <input value={form.url} maxLength={500} onChange={(e) => set('url', e.target.value)} placeholder={TYPES[form.type].url} />
          </div>
        )}
        {form.type !== 'ollama' && (
          <div className="field">
            <label>API-Schlüssel</label>
            <input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} placeholder={form.hasKey ? 'gesetzt, leer lassen = bleibt' : ''} />
          </div>
        )}
        <div className="field">
          <label>Region</label>
          <select value={form.region} onChange={(e) => set('region', e.target.value as Form['region'])}>
            {(Object.keys(REGION) as Form['region'][]).map((r) => (
              <option key={r} value={r}>
                {REGION[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Beschreibung (freiwillig)</label>
        <input value={form.description} maxLength={500} onChange={(e) => set('description', e.target.value)} />
      </div>
      <label className={v.check}>
        <input type="checkbox" checked={form.ocr} onChange={(e) => set('ocr', e.target.checked)} />
        <span>
          Texterkennung
          <small>Bild aufnehmen in Notizen und Quellen: Text auf dem Bild erkennen. Das Modell muss Bilder lesen können.</small>
        </span>
      </label>
      {form.type === 'ollama' && (
        <label className={v.check}>
          <input type="checkbox" checked={form.think} onChange={(e) => set('think', e.target.checked)} />
          <span>
            Nachdenken erlauben
            <small>Nur für Modelle mit Denkteil (z. B. Qwen 3). Langsamer.</small>
          </span>
        </label>
      )}
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <span className="grow" />
        <button className="btn" onClick={() => setForm(null)}>
          Abbrechen
        </button>
        <button className="btn primary" onClick={onSave} disabled={!form.name.trim() || !form.model.trim()}>
          Speichern
        </button>
      </div>
    </div>
  );
}
