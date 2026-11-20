/**
 * Einsetzen von außen prüfen und protokollieren (Konzept 8d.3; Wunsch Jo, 20. November 2026), für Karten-Editor und
 * Notizen:
 * - Text aus dem Projekt (Herkunftsmarke, lib/clip.ts) ist immer erlaubt; die Herkunft lässt sich als Zuschreibung anfügen.
 * - Text von außen wird standardmäßig bei jedem Einsetzen protokolliert (rules.logAll), sonst erst ab der Grenze.
 * - Die Grenze (rules.threshold) zählt je Ziel (Karte, Notiz) alles zusammen, was die Person schon von außen
 *   eingesetzt hat; so lässt sie sich nicht absatzweise umgehen. Darüber wird je nach Einstellung erlaubt, nach der
 *   Herkunft gefragt oder abgewiesen.
 * - Ohne Ziel (neue Notiz, noch nicht gespeichert) sammeln sich die Einträge und gehen mit flush(ziel) hinaus.
 */
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { get, post } from './api';
import { clipOrigin, type ClipMark } from './clip';
import { PASTE_ANSWERS, type PasteRules } from './pasteRules';

export type PasteAnswerKey = (typeof PASTE_ANSWERS)[number]['key'];

interface Pending {
  text: string;
  answer: PasteAnswerKey | null;
  note: string;
}

export interface PasteGuard {
  onPaste: (ev: ClipboardEvent<HTMLElement>) => void;
  origin: ClipMark | null;
  setOrigin: (o: ClipMark | null) => void;
  warn: string;
  setWarn: (w: string) => void;
  /** Hinweis bzw. Frage nach der Herkunft; open = Frage aufgeklappt */
  ask: { open: boolean; over: boolean } | null;
  setAsk: (a: { open: boolean; over: boolean } | null) => void;
  answer: PasteAnswerKey;
  setAnswer: (a: PasteAnswerKey) => void;
  note: string;
  setNote: (n: string) => void;
  /** Antwort auf die Frage speichern (für alle offenen Einträge dieser Bearbeitung) */
  answerPaste: () => Promise<void>;
  /** gesammelte Einträge einer neuen Notiz mit ihrem Ziel senden */
  flush: (target: string) => void;
  /** wurde in dieser Bearbeitung etwas von außen eingesetzt? */
  pastedOutside: boolean;
}

export function usePasteGuard(rules: PasteRules | null, target: string | null, place: () => string): PasteGuard {
  const [origin, setOrigin] = useState<ClipMark | null>(null);
  const [warn, setWarn] = useState('');
  const [ask, setAsk] = useState<{ open: boolean; over: boolean } | null>(null);
  const [answer, setAnswer] = useState<PasteAnswerKey>('quote');
  const [note, setNote] = useState('');
  const [pastedOutside, setPastedOutside] = useState(false);
  // schon von außen eingesetzt (Server) plus was in dieser Bearbeitung dazukam
  const total = useRef(0);
  const ids = useRef<number[]>([]);
  const pending = useRef<Pending[]>([]);

  const projectId = rules?.projectId;
  useEffect(() => {
    total.current = 0;
    if (!projectId || !target) return;
    let live = true;
    get<{ total: number }>(`/api/projects/${projectId}/einfuegen/summe?ziel=${encodeURIComponent(target)}`).then(
      (r) => live && (total.current = Math.max(total.current, r.total)),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [projectId, target]);

  function send(text: string, tgt: string, a: PasteAnswerKey | null = null, n = '') {
    if (!rules) return;
    post<{ id: number; total: number }>(`/api/projects/${rules.projectId}/einfuegen`, { scope: rules.scope, place: place().slice(0, 300), text, target: tgt, answer: a, note: n }).then(
      (r) => {
        if (!a) ids.current.push(r.id);
        total.current = Math.max(total.current, r.total);
      },
      () => {},
    );
  }

  function onPaste(ev: ClipboardEvent<HTMLElement>) {
    if (!rules) return;
    const pasted = ev.clipboardData.getData('text/plain');
    if (!pasted.trim()) return;
    const from = clipOrigin(ev.clipboardData, rules.projectId, pasted);
    setWarn('');
    if (from) {
      setOrigin(from);
      return;
    }
    const chars = [...pasted].length;
    const sum = total.current + chars;
    const over = sum >= rules.threshold;
    if (over && rules.outside === 'limit') {
      ev.preventDefault();
      const left = Math.max(0, rules.threshold - 1 - total.current);
      setWarn(
        total.current > 0
          ? `Von außen lassen sich hier insgesamt höchstens ${rules.threshold - 1} Zeichen einsetzen, ${left ? `noch ${left}` : 'es ist nichts mehr frei'}. Schreib den Gedanken in eigenen Worten oder zitiere eine kurze Stelle mit Quelle.`
          : `Von außen lassen sich hier höchstens ${rules.threshold - 1} Zeichen einsetzen. Schreib den Gedanken in eigenen Worten oder zitiere eine kurze Stelle mit Quelle.`,
      );
      return;
    }
    if (!over && !rules.logAll) return;
    total.current = sum;
    setPastedOutside(true);
    if (target) send(pasted, target);
    else pending.current.push({ text: pasted, answer: null, note: '' });
    setAsk((cur) => ({ open: cur?.open || (over && rules.outside === 'ask'), over: !!cur?.over || over }));
    if (!ask) {
      setAnswer('quote');
      setNote('');
    }
  }

  async function answerPaste() {
    if (!rules) return;
    const n = note.trim();
    for (const p of pending.current) if (!p.answer) Object.assign(p, { answer, note: n });
    const open = ids.current.splice(0);
    await Promise.all(open.map((id) => post(`/api/projects/${rules.projectId}/einfuegen/${id}`, { answer, note: n }).catch(() => {})));
    setAsk(null);
  }

  function flush(tgt: string) {
    for (const p of pending.current.splice(0)) send(p.text, tgt, p.answer, p.note);
  }

  return { onPaste, origin, setOrigin, warn, setWarn, ask, setAsk, answer, setAnswer, note, setNote, answerPaste, flush, pastedOutside };
}
