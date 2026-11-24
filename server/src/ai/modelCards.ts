/**
 * KI-Modellkarten (Wunsch Jo, 24. November 2026, nach dem Vorbild der KI-Konfiguration in Autogra.fi): je Karte ein
 * KI-Dienst (Ollama im Schulnetz, OpenAI-kompatibel, Gemini) mit Modell, Region und Verwendungen. Bisher gibt es nur
 * die Verwendung „Texterkennung“ (Bild aufnehmen in Notizen und Quellen). Gespeichert als JSON im kv-Speicher; der
 * API-Schlüssel verlässt den Server nie (die Liste zeigt nur, ob einer gesetzt ist).
 *
 * Import/Export im Format von Autogra.fi (`autografi-modellkarten`, Version 1, ohne Schlüssel), damit die Karten aus
 * Autogra.fi mit einem Klick übernommen werden können. Bewusst klein: keine Warteschlange, keine Zähler je Karte.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/index.js';

export const CARD_TYPES = ['ollama', 'openai', 'gemini'] as const;
export const CARD_USES = ['ocr'] as const;
export const REGIONS = ['eu', 'self-hosted', 'other'] as const;
export type CardType = (typeof CARD_TYPES)[number];
export type CardUse = (typeof CARD_USES)[number];

/** Gemini über die OpenAI-kompatible Schnittstelle von Google, wie in Autogra.fi */
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface ModelCard {
  id: string;
  name: string;
  type: CardType;
  url: string;
  model: string;
  description: string;
  region: (typeof REGIONS)[number];
  uses: CardUse[];
  /** Denkteil erlauben (Ollama, z. B. Qwen 3) */
  think: boolean;
  apiKey: string;
}
/** Was Browser sehen: ohne Schlüssel */
export type PublicCard = Omit<ModelCard, 'apiKey'> & { hasKey: boolean };

export const CardInput = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(CARD_TYPES),
  url: z.string().trim().max(500).default(''),
  model: z.string().trim().min(1).max(160),
  description: z.string().max(500).default(''),
  region: z.enum(REGIONS).optional(),
  uses: z.array(z.enum(CARD_USES)).max(CARD_USES.length).default([]),
  think: z.boolean().default(false),
  /** leer = Schlüssel bleibt (beim Ändern) bzw. keiner (Ollama) */
  apiKey: z.string().max(400).optional(),
});
export type CardInputT = z.infer<typeof CardInput>;

export class CardError extends Error {}

const KEY = 'ai_model_cards';

export class ModelCards {
  constructor(private db: Db) {}

  async all(): Promise<ModelCard[]> {
    const row = await this.db.selectFrom('kv').select('v').where('k', '=', KEY).executeTakeFirst();
    try {
      const list = row ? (JSON.parse(row.v) as ModelCard[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  async list(): Promise<PublicCard[]> {
    return (await this.all()).map(ModelCards.public);
  }

  static public(c: ModelCard): PublicCard {
    const { apiKey, ...rest } = c;
    return { ...rest, hasKey: !!apiKey };
  }

  private async save(list: ModelCard[]) {
    const v = JSON.stringify(list);
    const has = await this.db.selectFrom('kv').select('k').where('k', '=', KEY).executeTakeFirst();
    if (has) await this.db.updateTable('kv').set({ v }).where('k', '=', KEY).execute();
    else await this.db.insertInto('kv').values({ k: KEY, v }).execute();
  }

  /** Prüft die Angaben wie Autogra.fi (Adresse, Verschlüsselung, Schlüssel bei Gemini) */
  private normalise(d: CardInputT, old?: ModelCard): ModelCard {
    let url = d.type === 'gemini' ? GEMINI_URL : d.url.replace(/\/+$/, '');
    if (!url) throw new CardError('Bitte die Adresse des Dienstes angeben, z. B. http://ollama.schule.local:11434');
    if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new CardError('Die Adresse beginnt mit http:// oder https://');
    if (d.type !== 'ollama' && !url.startsWith('https://')) throw new CardError('Ohne Verschlüsselung (http://) nur für Ollama im Schulnetz.');
    if (d.type === 'openai' && /\/chat\/completions$/.test(url)) url = url.replace(/\/chat\/completions$/, '');
    const apiKey = d.apiKey?.trim() ? d.apiKey.trim() : (old?.apiKey ?? '');
    if (d.type === 'gemini' && !apiKey) throw new CardError('Gemini braucht einen API-Schlüssel.');
    const region = d.region ?? (d.type === 'ollama' ? 'self-hosted' : d.type === 'gemini' ? 'other' : 'eu');
    return { id: old?.id ?? randomBytes(6).toString('hex'), name: d.name, type: d.type, url, model: d.model, description: d.description, region, uses: [...new Set(d.uses)], think: d.type === 'ollama' && d.think, apiKey };
  }

  async add(d: CardInputT): Promise<PublicCard> {
    const list = await this.all();
    if (list.length >= 30) throw new CardError('Höchstens 30 Karten.');
    const c = this.normalise(d);
    await this.save([...list, c]);
    return ModelCards.public(c);
  }

  async update(id: string, d: CardInputT): Promise<PublicCard> {
    const list = await this.all();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) throw new CardError('Karte nicht gefunden');
    const c = this.normalise(d, list[i]);
    list[i] = c;
    await this.save(list);
    return ModelCards.public(c);
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return false;
    await this.save(next);
    return true;
  }

  async get(id: string): Promise<ModelCard | null> {
    return (await this.all()).find((c) => c.id === id) ?? null;
  }

  /** erste Karte mit dieser Verwendung (Reihenfolge der Liste = Vorrang) */
  async forUse(use: CardUse): Promise<ModelCard | null> {
    return (await this.all()).find((c) => c.uses.includes(use)) ?? null;
  }

  /** Reihenfolge ändern: Karte eine Stelle nach oben (Vorrang bei gleicher Verwendung) */
  async moveUp(id: string): Promise<void> {
    const list = await this.all();
    const i = list.findIndex((c) => c.id === id);
    if (i <= 0) return;
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    await this.save(list);
  }
}

/** Datei aus „Exportieren“ (hier oder in Autogra.fi). Verwendungen aus Autogra.fi: nur „ocr“ zählt hier. */
export const ImportFile = z.object({
  format: z.literal('autografi-modellkarten'),
  version: z.number().optional(),
  cards: z
    .array(
      z.object({
        name: z.string().nullish(),
        type: z.string().nullish(),
        url: z.string().nullish(),
        model: z.string().nullish(),
        description: z.string().nullish(),
        region: z.string().nullish(),
        think: z.boolean().nullish(),
        uses: z.array(z.string()).nullish(),
      }),
    )
    .max(100),
  assigned: z.record(z.string(), z.number()).nullish(),
});

/** Für den Export: Felder wie in Autogra.fi (IO_FIELDS), ohne Schlüssel */
export function exportCards(list: ModelCard[]) {
  return {
    format: 'autografi-modellkarten' as const,
    version: 1,
    exported_at: new Date().toISOString(),
    cards: list.map((c) => ({ name: c.name, type: c.type, url: c.url, model: c.model, description: c.description, region: c.region, think: c.think, uses: c.uses })),
    assigned: Object.fromEntries(CARD_USES.map((u) => [u, list.findIndex((c) => c.uses.includes(u))]).filter(([, i]) => (i as number) >= 0)),
  };
}
