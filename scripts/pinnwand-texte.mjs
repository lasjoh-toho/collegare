// Sprachdateien von mod_pinnwand ($string['schlüssel'] = '…';) als JSON, Deutsch vor Englisch.
// Drei Texte mit Platzhaltern bereitet view.php in Moodle eigens auf; hier genauso.
import { readFileSync } from 'node:fs';

function parse(file) {
  const out = {};
  const re = /^\$string\['([^']+)'\]\s*=\s*'((?:[^'\\]|\\.)*)';/gm;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(re)) out[m[1]] = m[2].replace(/\\(['\\])/g, '$1');
  return out;
}
const [de, en] = process.argv.slice(2).map(parse);
const s = { ...en, ...de };
const fill = (k, map) => s[k] !== undefined && (s[k] = s[k].replace(/\{\$a(?:->(\w+))?\}/g, (_, n) => map[n ?? ''] ?? _));
fill('photocount', { count: '{count}', max: '{max}' });
fill('photocount_unlimited', { '': '{count}' });
fill('boardof', { cur: '{cur}', total: '{total}' });
process.stdout.write(JSON.stringify(s));
