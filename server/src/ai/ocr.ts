/**
 * Texterkennung für „Bild aufnehmen“ in Notizen und Quellen. Anfrage und Anweisung wie in Autogra.fi
 * (StudentAssist::OCR_SYSTEM, OpenAiCompatibleProvider, OllamaProvider): ein Bild, Antwort als JSON {"text": …}.
 * Das Bild kommt schon aufbereitet aus dem Browser (Graustufen, Kontrast, verkleinert); gespeichert wird es hier nicht.
 */
import type { ModelCard } from './modelCards.js';

/** Aus Autogra.fi; dazu die Schriftart, damit die Notiz „Scan – Handschrift“ oder „Scan – Druckschrift“ vermerkt
 * (Wunsch Jo, 24. November 2026) */
export const OCR_SYSTEM =
  'Transkribiere den handgeschriebenen oder gedruckten Text auf dem Bild vollständig und exakt, einschließlich aller Fehler. ' +
  'Korrigiere nichts, ergänze nichts, gib keine Kommentare. Unleserliche Stellen markierst du mit [?]. ' +
  'Achte genau auf Umlaute und Akzente (ä, ö, ü, ß, é, è, ç …): Punkte und Striche über einem Buchstaben gehören dazu. ' +
  'Behalte die Zeilenumbrüche des Blattes bei: eine geschriebene Zeile ist eine Zeile im Text. ' +
  'Gib außerdem an, ob der Text überwiegend von Hand geschrieben (hand) oder gedruckt bzw. getippt (druck) ist. ' +
  'Antworte ausschließlich als JSON: {"text": "<Transkription>", "schrift": "hand" | "druck"}';

export type Script = 'hand' | 'print';

export class OcrError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export interface OcrResult {
  text: string;
  /** Schriftart laut KI; ohne Angabe Handschrift (der häufigere Fall bei „Bild aufnehmen“) */
  script: Script;
  tokensIn: number;
  tokensOut: number;
  ms: number;
}

/** JSON aus der Antwort lösen: Denkteil, Codeblöcke und Text um das Objekt fallen weg (wie Autogra.fi) */
export function answerJson(text: string): Record<string, unknown> | null {
  const t = text
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/^```(?:json)?|```$/gm, '')
    .trim();
  const parse = (s: string) => {
    try {
      const j = JSON.parse(s);
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = parse(t);
  if (direct) return direct;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? parse(t.slice(a, b + 1)) : null;
}

export async function recognize(card: ModelCard, image: Buffer, mime: string, fetchFn: typeof fetch = fetch, timeoutMs = 180_000): Promise<OcrResult> {
  const started = Date.now();
  const b64 = image.toString('base64');
  let url: string;
  let body: unknown;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (card.type === 'ollama') {
    url = card.url + '/api/chat';
    body = {
      model: card.model,
      messages: [
        { role: 'system', content: OCR_SYSTEM },
        { role: 'user', content: 'Seite', images: [b64] },
      ],
      stream: false,
      format: 'json',
      think: card.think,
      options: { temperature: 0, num_predict: 4000 + (card.think ? 8192 : 0) },
    };
  } else {
    url = card.url + '/chat/completions';
    if (card.apiKey) headers.authorization = 'Bearer ' + card.apiKey;
    body = {
      model: card.model,
      messages: [
        { role: 'system', content: OCR_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Seite' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    };
  }
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new OcrError(timeout ? 'Der KI-Dienst hat nicht rechtzeitig geantwortet.' : `Der KI-Dienst ist nicht erreichbar (${card.name}).`);
  }
  const raw = await res.text();
  if (res.status === 429) throw new OcrError('Der KI-Dienst ist gerade ausgelastet. Bitte in einer Minute noch einmal.', 429);
  if (!res.ok) {
    let msg = raw.slice(0, 200);
    try {
      const j = JSON.parse(raw);
      msg = String(j?.error?.message ?? j?.error ?? msg).slice(0, 200);
    } catch {
      /* Text */
    }
    throw new OcrError(`Der KI-Dienst meldet einen Fehler (${res.status}): ${msg}`);
  }
  let r: any;
  try {
    r = JSON.parse(raw);
  } catch {
    throw new OcrError('Die Antwort des KI-Dienstes ist unverständlich.');
  }
  const content: unknown = card.type === 'ollama' ? r?.message?.content : r?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new OcrError('Leere Antwort des KI-Dienstes.');
  const json = answerJson(content);
  const text = json && typeof json.text === 'string' ? json.text : null;
  if (text === null) throw new OcrError('Der KI-Dienst hat keinen Text geliefert. Bitte noch einmal versuchen oder den Text selbst abtippen.');
  return {
    text: text.replace(/\r\n?/g, '\n').trim(),
    script: /^(druck|print)/i.test(String(json?.schrift ?? json?.script ?? '')) ? 'print' : 'hand',
    tokensIn: Number(card.type === 'ollama' ? r?.prompt_eval_count : r?.usage?.prompt_tokens) || 0,
    tokensOut: Number(card.type === 'ollama' ? r?.eval_count : r?.usage?.completion_tokens) || 0,
    ms: Date.now() - started,
  };
}
