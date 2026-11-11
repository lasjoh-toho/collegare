/**
 * Lernseite im Tufte-Stil (Wunsch Jo, 11. November 2026): kleines, sicheres Markdown mit Randnotizen.
 *
 * Schreibweise:
 *   # Abschnitt, ## Unterabschnitt          Überschriften
 *   **fett**, *kursiv*, `Code`, [Text](https://…)
 *   Text^[nummerierte Randnotiz]            Seitennotiz wie bei Tufte
 *   Text^^[Randbemerkung ohne Nummer]       Marginalie
 *   {Wort|Erklärung}                        Worterklärung: Wort etwas kräftiger, Erklärung erst nach Antippen
 *   ![Bildunterschrift](Adresse)            Abbildung, Unterschrift am Rand
 *   ![!Bildunterschrift](Adresse)           Abbildung über die ganze Breite
 *   > Zitat                                 Zitat; Zeile „> — Name“ wird die Quelle
 *   - Punkt / 1. Punkt                      Listen
 *   https://youtu.be/…  (allein in der Zeile) Video eingebettet (YouTube ohne Cookies, Vimeo)
 *
 * Alles wird maskiert; Adressen nur https/http, Bilder zusätzlich data:image. Kein HTML aus dem Text.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function safeUrl(u: string, image = false): string | null {
  const t = u.trim();
  if (image && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(t)) return t.replace(/\s/g, '');
  try {
    const x = new URL(t);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null;
  } catch {
    return null;
  }
}

export function videoEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    const yt = (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    if (host === 'youtube.com' && u.searchParams.get('v')) return yt(u.searchParams.get('v')!);
    if (host === 'youtube.com' && u.pathname.startsWith('/shorts/')) return yt(u.pathname.split('/')[2]);
    if (host === 'youtu.be') return yt(u.pathname.slice(1));
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video/${u.pathname.split('/')[1]}?dnt=1`;
  } catch {}
  return null;
}

/** Schließende Klammer zu einer öffnenden an Stelle i (verschachtelt). */
function closing(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j;
  }
  return -1;
}

class Ctx {
  n = 0;
}

function inline(s: string, ctx: Ctx, notes = true): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += esc(s[i + 1]);
      i += 2;
      continue;
    }
    // Randnotizen
    if (notes && c === '^' && (s.startsWith('^[', i) || s.startsWith('^^[', i))) {
      const margin = s.startsWith('^^[', i);
      const start = i + (margin ? 2 : 1);
      const end = closing(s, start, '[', ']');
      if (end > 0) {
        const id = `sn-${++ctx.n}`;
        const body = inline(s.slice(start + 1, end), ctx, false);
        out += margin
          ? `<label for="${id}" class="margin-toggle">&#8853;</label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="marginnote">${body}</span>`
          : `<label for="${id}" class="margin-toggle sidenote-number"></label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="sidenote">${body}</span>`;
        i = end + 1;
        continue;
      }
    }
    // Worterklärung: {Wort|Erklärung}, öffnet sich erst beim Antippen (Lesefluss bleibt ungestört)
    if (notes && c === '{') {
      const end = closing(s, i, '{', '}');
      const bar = end > 0 ? s.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        const id = `gl-${++ctx.n}`;
        out += `<label for="${id}" class="gloss" title="Erklärung anzeigen">${inline(s.slice(i + 1, bar), ctx, false)}</label><input type="checkbox" id="${id}" class="gloss-toggle"/><span class="glossnote">${inline(s.slice(bar + 1, end), ctx, false)}</span>`;
        i = end + 1;
        continue;
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += `<code>${esc(s.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const end = closing(s, i, '[', ']');
      if (end > 0 && s[end + 1] === '(') {
        const pe = closing(s, end + 1, '(', ')');
        const url = pe > 0 ? safeUrl(s.slice(end + 2, pe)) : null;
        if (!url && s.slice(end + 2, pe).startsWith('#')) {
          // Sprungmarken aus Word (z. B. Fußnoten) nur als Text
          out += inline(s.slice(i + 1, end), ctx, notes);
          i = pe + 1;
          continue;
        }
        if (url) {
          out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inline(s.slice(i + 1, end), ctx, notes)}</a>`;
          i = pe + 1;
          continue;
        }
      }
    }
    let matched = false;
    for (const [mark, tag] of [
      ['**', 'strong'],
      ['__', 'strong'],
      ['*', 'em'],
      ['_', 'em'],
    ] as const) {
      if (!s.startsWith(mark, i) || !s[i + mark.length] || s[i + mark.length] === ' ') continue;
      // _ nur am Wortanfang, damit snake_case nicht kursiv wird
      if (mark[0] === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
      const end = s.indexOf(mark, i + mark.length);
      if (end > i + mark.length) {
        out += `<${tag}>${inline(s.slice(i + mark.length, end), ctx, notes)}</${tag}>`;
        i = end + mark.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    out += esc(c);
    i++;
  }
  return out;
}

const blockStart = /^(#{1,3} |> ?|[-*] |\d+[.)] |!\[|```)/;

/** Markdown der Lernseite zu HTML (für die Anzeige im Tufte-Stil). */
export function renderTufte(src: string): string {
  const ctx = new Ctx();
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let sectionOpen = false;
  const openSection = () => {
    if (!sectionOpen) {
      out.push('<section>');
      sectionOpen = true;
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(t);
    if (h) {
      if (h[1].length <= 2 && sectionOpen) {
        out.push('</section>');
        sectionOpen = false;
      }
      openSection();
      const tag = h[1].length === 1 ? 'h2' : h[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(h[2], ctx)}</${tag}>`);
      i++;
      continue;
    }
    openSection();
    // Video allein in der Zeile
    const vid = /^https?:\/\/\S+$/.test(t) ? videoEmbed(t) : null;
    if (vid) {
      out.push(`<figure class="iframe-wrapper"><iframe src="${esc(vid)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>`);
      i++;
      continue;
    }
    const img = /^!\[(!?)(.*)\]\((.*)\)$/.exec(t);
    if (img) {
      const url = safeUrl(img[3], true);
      if (url) {
        const full = img[1] === '!';
        const cap = img[2] ? inline(img[2], ctx, false) : '';
        const id = `mn-${++ctx.n}`;
        out.push(
          full
            ? `<figure class="fullwidth"><img src="${esc(url)}" alt="${esc(img[2])}"/>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`
            : `<figure>${cap ? `<label for="${id}" class="margin-toggle">&#8853;</label><input type="checkbox" id="${id}" class="margin-toggle"/><span class="marginnote">${cap}</span>` : ''}<img src="${esc(url)}" alt="${esc(img[2])}"/></figure>`,
        );
      }
      i++;
      continue;
    }
    if (t.startsWith('>')) {
      const q: string[] = [];
      let who = '';
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        const l = lines[i].trim().replace(/^> ?/, '');
        if (/^(—|--|-) /.test(l)) who = l.replace(/^(—|--|-) /, '');
        else q.push(l);
        i++;
      }
      out.push(`<blockquote><p>${inline(q.join(' '), ctx)}</p>${who ? `<footer>${inline(who, ctx)}</footer>` : ''}</blockquote>`);
      continue;
    }
    if (/^([-*]|\d+[.)]) /.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)]) /.test(lines[i])) {
        let item = lines[i].trim().replace(/^([-*]|\d+[.)]) /, '');
        i++;
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*([-*]|\d+[.)]) /.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item, ctx)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    // Absatz bis zur Leerzeile oder zum nächsten Block
    const para: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '), ctx)}</p>`);
  }
  if (sectionOpen) out.push('</section>');
  return out.join('\n');
}
