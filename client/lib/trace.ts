/**
 * Spur im Text (Paste and Shake, Wunsch Jo, 20. November 2026): Welche Stellen eines Texts stammen noch aus Vorlagen,
 * die von außen eingesetzt wurden?
 *
 * „Paste and Shake“ heißt: Stücke aus mehreren Quellen einsetzen, umstellen und ein wenig umformulieren. Ein Vergleich
 * ganzer Absätze findet das nicht mehr. Wir vergleichen deshalb Wortfolgen: Jede Folge von SHINGLE Wörtern, die auch in
 * einer Vorlage steht, färbt ihre Wörter in der Farbe dieser Vorlage. Übrig bleiben nur Läufe ab MIN_RUN Wörtern, damit
 * Allerweltswendungen („in der Zeit von“) nicht anschlagen. Einzelne getauschte Wörter unterbrechen einen Lauf nur
 * kurz. Stehen die Läufe einer Vorlage im Text in anderer Reihenfolge als in der Vorlage, ist sie „umgestellt“.
 *
 * Das ist ein Hinweis für das Gespräch, kein Beweis: Wer gut umformuliert, ist nicht mehr zu sehen, und wer korrekt
 * zitiert, ist auch gefärbt.
 */
export const SHINGLE = 3;
export const MIN_RUN = 5;

interface Tok {
  w: string;
  start: number;
  end: number;
}

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ w: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  return out;
}

const key = (t: Tok[], i: number) => t.slice(i, i + SHINGLE).map((x) => x.w).join(' ');

export interface TraceSource {
  id: number;
  text: string;
}

export interface TraceSpan {
  start: number;
  end: number;
  /** Index der Vorlage in sources, null = eigener Text */
  src: number | null;
}

export interface TraceStat {
  /** Anteil der Wörter des Texts, die aus dieser Vorlage stammen */
  share: number;
  /** Anteil der Vorlage, der noch im Text steckt */
  kept: number;
  /** Läufe stehen in anderer Reihenfolge als in der Vorlage */
  reordered: boolean;
  runs: number;
}

export interface Trace {
  spans: TraceSpan[];
  stats: TraceStat[];
  /** Anteil der Wörter, die aus irgendeiner Vorlage stammen */
  outside: number;
  words: number;
}

export function trace(text: string, sources: TraceSource[]): Trace {
  const t = tokens(text);
  const n = t.length;
  const owner: (number | null)[] = Array(n).fill(null);
  const stats: TraceStat[] = [];
  sources.forEach((src, si) => {
    const s = tokens(src.text);
    // Wortfolge → erste Stelle in der Vorlage
    const where = new Map<string, number>();
    for (let i = 0; i + SHINGLE <= s.length; i++) if (!where.has(key(s, i))) where.set(key(s, i), i);
    const cover = Array<boolean>(n).fill(false);
    const pos: (number | null)[] = Array(n).fill(null);
    const found = new Set<number>();
    for (let j = 0; j + SHINGLE <= n; j++) {
      const at = where.get(key(t, j));
      if (at === undefined) continue;
      found.add(at);
      for (let k = 0; k < SHINGLE; k++) {
        cover[j + k] = true;
        pos[j + k] ??= at + k;
      }
    }
    // nur Läufe ab MIN_RUN Wörtern
    let runs = 0;
    const firsts: number[] = [];
    for (let j = 0; j < n; ) {
      if (!cover[j]) {
        j++;
        continue;
      }
      let e = j;
      while (e < n && cover[e]) e++;
      if (e - j >= MIN_RUN) {
        runs++;
        firsts.push(pos[j] ?? 0);
        for (let k = j; k < e; k++) owner[k] ??= si;
      } else for (let k = j; k < e; k++) cover[k] = false;
      j = e;
    }
    const mine = owner.filter((o) => o === si).length;
    const shingles = Math.max(1, s.length - SHINGLE + 1);
    stats.push({ share: n ? mine / n : 0, kept: runs ? Math.min(1, found.size / shingles) : 0, reordered: firsts.some((p, i) => i > 0 && p < firsts[i - 1]), runs });
  });
  // zusammenhängende Stücke gleicher Herkunft; ein Zwischenraum gehört dazu, wenn auf beiden Seiten dieselbe Vorlage steht
  const out: TraceSpan[] = [];
  const push = (start: number, end: number, src: number | null) => {
    if (end <= start) return;
    const last = out[out.length - 1];
    if (last && last.src === src && last.end === start) last.end = end;
    else out.push({ start, end, src });
  };
  let prev = 0;
  for (let j = 0; j < n; j++) {
    push(prev, t[j].start, j > 0 && owner[j - 1] !== null && owner[j - 1] === owner[j] ? owner[j] : null);
    push(t[j].start, t[j].end, owner[j]);
    prev = t[j].end;
  }
  push(prev, text.length, null);
  const outside = n ? owner.filter((o) => o !== null).length / n : 0;
  return { spans: out, stats, outside, words: n };
}

/** Farben der Vorlagen: hell hinterlegt, im Nachtmodus über die Deckkraft dunkler */
export const TRACE_COLORS = ['#f2b134', '#5fa8d3', '#e07a5f', '#81b29a', '#b388eb', '#f28fad', '#9bc53d', '#4ecdc4'];
