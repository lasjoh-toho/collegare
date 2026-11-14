/**
 * Kleines, sicheres Markdown für Kartentexte: Überschriften, Listen, fett, kursiv, Code, Links [Text](https://…) und
 * Zeilen „Quelle: …“ (Karten-Editor, Konzept 8d.3).
 * Erst wird alles maskiert, dann werden nur diese Auszeichnungen erzeugt; HTML aus dem Text kommt nie durch.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

export function renderMarkdown(text: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    close();
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (/^Quelle:\s/.test(line)) out.push(`<p class="md-source">${inline(line)}</p>`);
    else if (line) out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join('');
}

/**
 * Rückweg für den WYSIWYG-Editor: Inhalt eines contentEditable wieder als dieses kleine Markdown. Kennt nur, was
 * renderMarkdown erzeugt (Absätze, Überschriften, Listen, fett, kursiv, Code, Links); alles andere wird zu Text.
 */
export function htmlToMarkdown(root: Node): string {
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    lines.push(cur.replace(/ /g, ' ').trimEnd());
    cur = '';
  };
  // Leerzeichen am Rand außerhalb der Zeichen, sonst erkennt renderMarkdown die Auszeichnung nicht
  const mark = (m: string, s: string) => {
    const t = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
    return t[2] ? t[1] + m + t[2] + m + t[3] : s;
  };
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\n/g, ' ');
    if (!(n instanceof HTMLElement)) return '';
    const tag = n.tagName;
    if (tag === 'BR') return '\n';
    const inner = [...n.childNodes].map(inline).join('');
    if (tag === 'STRONG' || tag === 'B') return mark('**', inner);
    if (tag === 'EM' || tag === 'I') return mark('*', inner);
    if (tag === 'CODE') return inner ? '`' + inner.replace(/`/g, "'") + '`' : '';
    if (tag === 'A') {
      const url = n.getAttribute('href') ?? '';
      return /^https?:\/\//.test(url) && inner.trim() ? `[${inner.replace(/[[\]]/g, '')}](${url.replace(/[\s)]/g, encodeURIComponent)})` : inner;
    }
    return inner;
  };
  const push = (s: string) => {
    const parts = s.split('\n');
    cur += parts[0];
    for (const p of parts.slice(1)) {
      flush();
      cur = p;
    }
  };
  const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE)$/;
  const block = (n: Node) => {
    if (!(n instanceof HTMLElement) || !BLOCK.test(n.tagName)) return push(inline(n));
    if (cur.trim()) flush();
    else cur = '';
    const tag = n.tagName;
    if (tag === 'UL' || tag === 'OL') {
      let i = 0;
      for (const li of n.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') {
          block(li);
          continue;
        }
        i++;
        const prefix = tag === 'OL' ? `${i}. ` : '- ';
        const text = [...li.childNodes].filter((c) => !(c instanceof HTMLElement && /^(UL|OL)$/.test(c.tagName))).map(inline).join('').replace(/\n/g, ' ').trim();
        lines.push(prefix + text);
        for (const sub of li.children) if (/^(UL|OL)$/.test(sub.tagName)) block(sub);
      }
      return;
    }
    const h = /^H([1-6])$/.exec(tag);
    if (h) {
      const level = Math.min(3, Math.max(1, Number(h[1]) - 2));
      push('#'.repeat(level) + ' ' + [...n.childNodes].map(inline).join('').replace(/\n/g, ' ').trim());
      flush();
      return;
    }
    for (const c of n.childNodes) block(c);
    flush();
  };
  for (const c of root.childNodes) block(c);
  if (cur) flush();
  // Leerzeilen am Rand weg, mehrere Leerzeilen zu einer
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '');
}
