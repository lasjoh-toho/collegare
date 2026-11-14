/**
 * Lernseite „wie in Word“ bearbeiten (Wunsch Jo, 14. November 2026): Hin- und Rückweg zwischen dem Markdown der
 * Lernseite (lib/tufte.ts) und dem Inhalt des Editierfelds. Randnotizen, Marginalien, Bilder und Videos erscheinen
 * im Feld als Bausteine, die man antippt, um sie zu ändern; Worterklärungen als markiertes Wort.
 * Wie renderTufte wird alles maskiert; Adressen nur https/http, Bilder zusätzlich data:image.
 */
import { videoEmbed } from './tufte';

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

/** Markdown einer Notiz als schlichter Text für die Anzeige im Baustein */
export const plain = (md: string) => md.replace(/\\(.)/g, '$1').replace(/\*\*|__|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** Baustein für eine Randnotiz oder Marginalie (Inhalt bleibt Markdown im Attribut) */
export const noteHtml = (kind: 'note' | 'margin', md: string) =>
  `<span class="ed-note ed-${kind}" contenteditable="false" data-kind="${kind}" data-text="${esc(md)}" title="Antippen zum Ändern">${esc(plain(md)) || '…'}</span>`;
export const glossHtml = (word: string, explain: string) => `<span class="ed-gloss" data-explain="${esc(explain)}" title="Worterklärung, antippen zum Ändern">${esc(word)}</span>`;
export const imageHtml = (src: string, cap: string, full: boolean) =>
  `<figure class="ed-img" contenteditable="false" data-src="${esc(src)}" data-cap="${esc(cap)}" data-full="${full ? '1' : ''}" title="Antippen zum Ändern"><img src="${esc(src)}" alt=""/><figcaption>${esc(plain(cap)) || 'ohne Unterschrift'}${full ? ' · ganze Breite' : ''}</figcaption></figure>`;
export const videoHtml = (url: string) => `<figure class="ed-video" contenteditable="false" data-url="${esc(url)}" title="Antippen zum Ändern">▶ Video: ${esc(url)}</figure>`;

function inline(s: string, notes = true): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += esc(s[i + 1]);
      i += 2;
      continue;
    }
    if (notes && c === '^' && (s.startsWith('^[', i) || s.startsWith('^^[', i))) {
      const margin = s.startsWith('^^[', i);
      const start = i + (margin ? 2 : 1);
      const end = closing(s, start, '[', ']');
      if (end > 0) {
        out += noteHtml(margin ? 'margin' : 'note', s.slice(start + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (notes && c === '{') {
      const end = closing(s, i, '{', '}');
      const bar = end > 0 ? s.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        out += `<span class="ed-gloss" data-explain="${esc(s.slice(bar + 1, end))}" title="Worterklärung, antippen zum Ändern">${inline(s.slice(i + 1, bar), false)}</span>`;
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
        const raw = pe > 0 ? s.slice(end + 2, pe) : '';
        const url = pe > 0 ? safeUrl(raw) : null;
        if (url || raw.startsWith('#')) {
          const text = inline(s.slice(i + 1, end), notes);
          out += url ? `<a href="${esc(url)}">${text}</a>` : text;
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
      if (mark[0] === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
      const end = s.indexOf(mark, i + mark.length);
      if (end > i + mark.length) {
        out += `<${tag}>${inline(s.slice(i + mark.length, end), notes)}</${tag}>`;
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

/** Markdown der Lernseite → Inhalt des Editierfelds */
export function tufteToEdit(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(t);
    if (h) {
      const tag = h[1].length <= 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(h[2])}</${tag}>`);
      i++;
      continue;
    }
    if (/^https?:\/\/\S+$/.test(t) && videoEmbed(t)) {
      out.push(videoHtml(t));
      i++;
      continue;
    }
    const img = /^!\[(!?)(.*)\]\((.*)\)$/.exec(t);
    if (img) {
      const url = safeUrl(img[3], true);
      if (url) out.push(imageHtml(url, img[2], img[1] === '!'));
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
      out.push(`<blockquote><p>${inline(q.join(' '))}</p>${who ? `<p class="ed-who">— ${inline(who)}</p>` : ''}</blockquote>`);
      continue;
    }
    if (/^([-*]|\d+[.)]) /.test(t)) {
      const ordered = /^\d/.test(t);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)]) /.test(lines[i])) {
        let item = lines[i].trim().replace(/^([-*]|\d+[.)]) /, '');
        i++;
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !/^\s*([-*]|\d+[.)]) /.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !blockStart.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}

/** Zeichen, die im Markdown etwas bedeuten, im Fließtext maskieren */
const escText = (s: string) => s.replace(/[\\*_`[\]{}^]/g, (c) => '\\' + c);

/** Inhalt des Editierfelds → Markdown der Lernseite */
export function editToTufte(root: Node): string {
  const blocks: string[] = [];
  const mark = (m: string, s: string) => {
    const t = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
    return t[2] ? t[1] + m + t[2] + m + t[3] : s;
  };
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return escText((n.textContent ?? '').replace(/[\n\u00a0]/g, ' '));
    if (!(n instanceof HTMLElement)) return '';
    const tag = n.tagName;
    if (tag === 'BR') return '\n';
    if (n.classList.contains('ed-note')) return (n.dataset.kind === 'margin' ? '^^[' : '^[') + (n.dataset.text ?? '') + ']';
    const inner = [...n.childNodes].map(inline).join('');
    if (n.classList.contains('ed-gloss')) return inner.trim() ? `{${inner}|${n.dataset.explain ?? ''}}` : '';
    if (tag === 'STRONG' || tag === 'B') return mark('**', inner);
    if (tag === 'EM' || tag === 'I') return mark('*', inner);
    if (tag === 'CODE') return inner ? '`' + (n.textContent ?? '').replace(/`/g, "'") + '`' : '';
    if (tag === 'A') {
      const url = n.getAttribute('href') ?? '';
      return /^https?:\/\//.test(url) && inner.trim() ? `[${inner}](${url.replace(/[\s()]/g, encodeURIComponent)})` : inner;
    }
    return inner;
  };
  // Zeilenanfang, der sonst als Block gelesen würde, maskieren
  const para = (s: string) =>
    s
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((l) => l.replace(/^(#{1,3} |> ?|[-+] |!\[)/, '\\$1').replace(/^(\d+)([.)] )/, '$1\\$2'))
      .join('\n\n');
  const listItems = (el: Element, ordered: boolean, depth = 0): string[] => {
    const out: string[] = [];
    let k = 0;
    for (const li of el.children) {
      if (/^(UL|OL)$/.test(li.tagName)) {
        out.push(...listItems(li, li.tagName === 'OL', depth + 1));
        continue;
      }
      const text = [...li.childNodes]
        .filter((c) => !(c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName)))
        .map(inline)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      out.push(`${ordered ? `${++k}.` : '-'} ${text}`);
      for (const sub of li.children) if (/^(UL|OL)$/.test(sub.tagName)) out.push(...listItems(sub, sub.tagName === 'OL', depth + 1));
    }
    return out;
  };
  let run = '';
  const flushRun = () => {
    const p = para(run);
    if (p) blocks.push(p);
    run = '';
  };
  const block = (n: Node) => {
    if (!(n instanceof HTMLElement)) return void (run += inline(n));
    const tag = n.tagName;
    if (n.classList.contains('ed-img')) {
      flushRun();
      const src = n.dataset.src ?? '';
      if (safeUrl(src, true)) blocks.push(`![${n.dataset.full ? '!' : ''}${(n.dataset.cap ?? '').replace(/[[\]]/g, '')}](${src})`);
      return;
    }
    if (n.classList.contains('ed-video')) {
      flushRun();
      if (n.dataset.url) blocks.push(n.dataset.url);
      return;
    }
    if (!/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|PRE|FIGURE)$/.test(tag)) return void (run += inline(n));
    flushRun();
    if (/^H[1-6]$/.test(tag)) {
      const text = [...n.childNodes].map(inline).join('').replace(/\s+/g, ' ').trim();
      if (text) blocks.push((Number(tag[1]) >= 3 ? '### ' : '## ') + text);
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      const items = listItems(n, tag === 'OL');
      if (items.length) blocks.push(items.join('\n'));
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const lines: string[] = [];
      let who = '';
      for (const c of n.childNodes) {
        const text = inline(c).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (c instanceof HTMLElement && c.classList.contains('ed-who')) who = text.replace(/^(—|--|-)\s*/, '');
        else if (/^(—|--) /.test(text)) who = text.replace(/^(—|--) /, '');
        else lines.push('> ' + text);
      }
      if (who) lines.push('> — ' + who);
      if (lines.length) blocks.push(lines.join('\n'));
      return;
    }
    // Absatz (oder Container, in dem der Browser weitere Blöcke abgelegt hat)
    if ([...n.children].some((c) => /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|FIGURE)$/.test(c.tagName) || c.classList.contains('ed-img') || c.classList.contains('ed-video'))) {
      for (const c of n.childNodes) block(c);
      flushRun();
      return;
    }
    run = [...n.childNodes].map(inline).join('');
    flushRun();
  };
  for (const c of root.childNodes) block(c);
  flushRun();
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}
