/**
 * Einfüge-Regeln des Projekts für die Editoren (Konzept 8d.3). Die Seite stellt sie bereit, Karten-Editoren lesen sie;
 * ohne Bereitstellung (z. B. in der Themen-Mindmap der Lehrkraft) wird nichts geprüft.
 */
import { createContext, useContext } from 'react';

export interface PasteRules {
  projectId: number;
  scope: string;
  outside: 'allow' | 'ask' | 'limit';
  threshold: number;
}

export const PasteRulesContext = createContext<PasteRules | null>(null);
export const usePasteRules = () => useContext(PasteRulesContext);

export const PASTE_ANSWERS: { key: 'quote' | 'draft' | 'ai' | 'other'; label: string; hint: string }[] = [
  { key: 'quote', label: 'Zitat aus einer Quelle', hint: 'Quelle mit Seite, z. B. Schulbuch S. 42' },
  { key: 'draft', label: 'Eigener Vorentwurf', hint: 'Wo stand der Entwurf? (optional)' },
  { key: 'ai', label: 'KI-Werkzeug', hint: 'Welches Werkzeug, welche Frage?' },
  { key: 'other', label: 'Sonstiges', hint: 'Woher stammt der Text?' },
];
