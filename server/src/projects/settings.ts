/**
 * Projekt-Einstellungen (Konzept Abschnitt 4, „Projekt-Einstellungen“) und der Rahmen der Administration.
 *
 * Gespeichert als JSON in projects.settings. Unbekannte oder fehlende Felder werden beim Lesen mit den
 * Standardwerten aufgefüllt, damit neue Einstellungen ohne Migration dazukommen können.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';

/** brochure: gemeinsame Broschüre aller Gruppen (Wunsch Jo, 11. November 2026) */
export const DOC_TYPES = ['section', 'slides', 'handout', 'brochure', 'sheet', 'pdf', 'formula'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Import-Gruppen und die zugehörigen Dateiendungen. */
export const IMPORT_TYPES = {
  text: ['docx', 'odt', 'rtf', 'txt', 'md'],
  slides: ['pptx', 'odp', 'ppt'],
  sheets: ['xlsx', 'ods', 'csv'],
  pdf: ['pdf'],
  images: ['jpg', 'jpeg', 'png', 'heic', 'webp'],
  bib: ['bib', 'ris'],
} as const;
export type ImportType = keyof typeof IMPORT_TYPES;
const IMPORT_KEYS = Object.keys(IMPORT_TYPES) as [ImportType, ...ImportType[]];

export const EXPORT_FORMATS = ['docx', 'pdf', 'pptx', 'bento', 'quarto'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PHASES = ['topic', 'groups', 'orientation', 'research', 'drafting', 'presentation'] as const;
const PhaseSchema = z.object({
  state: z.enum(['on', 'scheduled', 'off']),
  from: z.number().int().nullable().default(null),
  to: z.number().int().nullable().default(null),
});

const flags = <T extends readonly string[]>(keys: T) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.boolean()])) as { [K in T[number]]: z.ZodBoolean });

export const SettingsSchema = z.object({
  /** Leitfrage bzw. Aufgabenstellung, für Lernende sichtbar */
  brief: z.string().max(5000),
  subject: z.string().max(60).nullable(),
  /** teacher: Lehrkraft teilt ein; choice: Lernende wählen eine Säule; open: Lernende dürfen auch Säulen anlegen */
  groupFormation: z.enum(['teacher', 'choice', 'open']),
  groupMin: z.number().int().min(1).max(30),
  groupMax: z.number().int().min(1).max(30),
  /** Bis wann Lernende selbst wählen dürfen (ms); danach entscheidet die Lehrkraft */
  choiceDeadline: z.number().int().nullable(),
  studentsSetTopic: z.boolean(),
  /** Gemeinsame Themen-Mindmap vor der Gruppenbildung: wer darf daran arbeiten (Wunsch Jo, 11. November 2026) */
  topicMapEdit: z.enum(['teacher', 'all']),
  /** Erklärblase in der Mindmap: an/aus und eigener Text der Lehrkraft (leer = Standardtext) */
  mapHelp: z.boolean(),
  mapHelpText: z.string().max(1000),
  /** Chat je Gruppe und Chat für alle im Projekt */
  chatGroups: z.boolean(),
  chatAll: z.boolean(),
  roles: z.array(z.string().min(1).max(60)).max(20),
  freeRoles: z.boolean(),
  phases: z.object(Object.fromEntries(PHASES.map((p) => [p, PhaseSchema])) as { [K in (typeof PHASES)[number]]: typeof PhaseSchema }),
  docTypes: flags(DOC_TYPES),
  importTypes: flags(IMPORT_KEYS),
  exportFormats: flags(EXPORT_FORMATS),
  maxFileMb: z.number().min(1).max(500),
  formulaTransform: z.boolean(),
  formulaCalc: z.boolean(),
  finishLock: z.boolean(),
  reopenBy: z.enum(['teacher', 'group']),
  pasteThreshold: z.number().int().min(20).max(100_000),
  /** Einsetzen von außen (Konzept 8d.3): erlauben, nach der Herkunft fragen, nur bis pasteThreshold Zeichen */
  pasteOutside: z.enum(['allow', 'ask', 'limit']),
  logbookRequired: z.boolean(),
  aiFeedback: z.boolean(),
  aiDailyLimit: z.number().int().min(0).max(100),
});
export type ProjectSettings = z.infer<typeof SettingsSchema>;

const phase = (state: 'on' | 'off') => ({ state, from: null, to: null });

export const DEFAULT_SETTINGS: ProjectSettings = {
  brief: '',
  subject: null,
  groupFormation: 'teacher',
  groupMin: 2,
  groupMax: 4,
  choiceDeadline: null,
  studentsSetTopic: true,
  topicMapEdit: 'all',
  mapHelp: true,
  mapHelpText: '',
  chatGroups: true,
  chatAll: true,
  roles: ['Zeitwächter:in', 'Quellenverantwortliche:r', 'Layout', 'Moderation'],
  freeRoles: true,
  phases: { topic: phase('on'), groups: phase('on'), orientation: phase('on'), research: phase('on'), drafting: phase('on'), presentation: phase('on') },
  docTypes: { section: true, slides: true, handout: true, brochure: false, sheet: false, pdf: true, formula: false },
  importTypes: { text: true, slides: true, sheets: false, pdf: true, images: true, bib: true },
  exportFormats: { docx: true, pdf: true, pptx: true, bento: true, quarto: false },
  maxFileMb: 25,
  formulaTransform: false,
  formulaCalc: false,
  finishLock: true,
  reopenBy: 'teacher',
  pasteThreshold: 200,
  pasteOutside: 'allow',
  logbookRequired: true,
  aiFeedback: false,
  aiDailyLimit: 5,
};

/** Voreinstellungen der Leiste oben auf der Einstellungsseite: setzen nur die genannten Felder. */
export const PRESETS: Record<string, { title: string; patch: Partial<ProjectSettings> }> = {
  referat: {
    title: 'Gruppenreferat',
    patch: { groupFormation: 'choice', docTypes: { ...DEFAULT_SETTINGS.docTypes, slides: true, handout: true }, logbookRequired: true, aiFeedback: true, pasteOutside: 'allow' },
  },
  seminar: {
    title: 'Seminararbeit in Gruppen',
    patch: { groupFormation: 'teacher', docTypes: { ...DEFAULT_SETTINGS.docTypes, section: true, slides: true }, exportFormats: { ...DEFAULT_SETTINGS.exportFormats, quarto: true }, aiFeedback: true },
  },
  facharbeit: {
    title: 'Facharbeit (einzeln)',
    patch: { groupFormation: 'teacher', studentsSetTopic: true, docTypes: { ...DEFAULT_SETTINGS.docTypes, slides: false, handout: false }, exportFormats: { ...DEFAULT_SETTINGS.exportFormats, quarto: true }, aiFeedback: true },
  },
  pruefung: {
    title: 'Präsentationsprüfung',
    patch: { groupFormation: 'teacher', aiFeedback: false, pasteOutside: 'ask', pasteThreshold: 50, logbookRequired: true, reopenBy: 'teacher' },
  },
};

/** Rahmen der Administration: Was Lehrkräfte überhaupt einschalten dürfen. */
export const FrameSchema = z.object({
  docTypes: flags(DOC_TYPES),
  importTypes: flags(IMPORT_KEYS),
  exportFormats: flags(EXPORT_FORMATS),
  maxFileMb: z.number().min(1).max(500),
  ai: z.boolean(),
  /** Tippfluss-Hinweise (Entscheidung 10.5): aus, nur Lernende, Lernende und Lehrkraft */
  typingHints: z.enum(['off', 'students', 'students_teachers']),
  openOffice: z.boolean(),
});
export type Frame = z.infer<typeof FrameSchema>;

export const DEFAULT_FRAME: Frame = {
  docTypes: { section: true, slides: true, handout: true, brochure: true, sheet: true, pdf: true, formula: true },
  importTypes: { text: true, slides: true, sheets: true, pdf: true, images: true, bib: true },
  exportFormats: { docx: true, pdf: true, pptx: true, bento: true, quarto: true },
  maxFileMb: 50,
  ai: true,
  typingHints: 'off',
  openOffice: false,
};

/** Liest gespeichertes JSON robust ein: Standardwerte für Fehlendes, Ungültiges fällt auf den Standard zurück. */
export function parseSettings(json: string | null | undefined): ProjectSettings & { revision: number } {
  let raw: Record<string, unknown> = {};
  try {
    raw = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    raw = {};
  }
  // bis 0.6.1 hieß „nach der Herkunft fragen“ pasteExplain
  if (!('pasteOutside' in raw) && raw.pasteExplain === true) raw.pasteOutside = 'ask';
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in raw)) continue;
    const merged = def && typeof def === 'object' && !Array.isArray(def) ? { ...def, ...(raw[k] as object) } : raw[k];
    const ok = SettingsSchema.shape[k as keyof ProjectSettings].safeParse(merged);
    if (ok.success) out[k] = ok.data;
  }
  return { ...(out as ProjectSettings), revision: typeof raw.revision === 'number' ? raw.revision : 0 };
}

/** Was der Rahmen nicht zulässt, wird abgeschaltet (die Oberfläche zeigt es grau). */
export function clampToFrame(s: ProjectSettings, f: Frame): ProjectSettings {
  const and = <T extends Record<string, boolean>>(a: T, b: T): T => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v && b[k] !== false])) as T;
  return {
    ...s,
    docTypes: and(s.docTypes, f.docTypes),
    importTypes: and(s.importTypes, f.importTypes),
    exportFormats: and(s.exportFormats, f.exportFormats),
    maxFileMb: Math.min(s.maxFileMb, f.maxFileMb),
    aiFeedback: s.aiFeedback && f.ai,
  };
}

/** Erlaubte Dateiendungen für Importe in einem Projekt. */
export function allowedExtensions(s: ProjectSettings): string[] {
  return (Object.keys(IMPORT_TYPES) as ImportType[]).filter((k) => s.importTypes[k]).flatMap((k) => [...IMPORT_TYPES[k]]);
}

const FRAME_KEY = 'instance_frame';

export class FrameStore {
  constructor(private db: Db) {}

  async get(): Promise<Frame> {
    const row = await this.db.selectFrom('kv').select('v').where('k', '=', FRAME_KEY).executeTakeFirst();
    if (!row) return DEFAULT_FRAME;
    const parsed = FrameSchema.partial().safeParse(JSON.parse(row.v));
    return parsed.success ? { ...DEFAULT_FRAME, ...parsed.data } : DEFAULT_FRAME;
  }

  async set(f: Frame): Promise<void> {
    const v = JSON.stringify(f);
    const has = await this.db.selectFrom('kv').select('k').where('k', '=', FRAME_KEY).executeTakeFirst();
    if (has) await this.db.updateTable('kv').set({ v }).where('k', '=', FRAME_KEY).execute();
    else await this.db.insertInto('kv').values({ k: FRAME_KEY, v }).execute();
  }
}
