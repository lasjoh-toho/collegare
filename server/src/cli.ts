/**
 * Verwaltung auf der Kommandozeile (auf der VM als Dienstkonto ausführen):
 *   node dist/cli.js admin:create <kürzel> "<Name>"   – Passwort aus COLLEGARE_PASSWORD oder Eingabe
 *   node dist/cli.js admin:password <kürzel>
 *   node dist/cli.js audit:verify
 *   node dist/cli.js pinnwand:pruefen    – Medien der Pinnwände: fehlt eine Datei, liegt etwas Unbekanntes im Ordner?
 *   node dist/cli.js pinnwand:umziehen   – noch in der Datenbank liegende Medien sofort in die Ordner umtragen
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { configFromEnv, createServices } from './services.js';
import { checkMedia, moveBlobs } from './pinnwand/media.js';

/** Eine Zeile lesen; mit hidden ohne Anzeige der Zeichen (Passwort im Terminal). */
async function ask(question: string, hidden: boolean): Promise<string> {
  const tty = !!process.stdin.isTTY && hidden;
  let mute = false;
  // Ausgabe über einen Filter: nach der Frage wird nichts mehr zurückgeschrieben
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!mute) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: tty ? output : process.stdout, terminal: tty });
  const pending = rl.question(question);
  mute = tty;
  const answer = await pending;
  rl.close();
  if (tty) process.stdout.write('\n');
  return answer;
}

async function askPassword(): Promise<string> {
  if (process.env.COLLEGARE_PASSWORD) return process.env.COLLEGARE_PASSWORD;
  // ohne Terminal (z. B. echo … | cli) nur einmal lesen
  if (!process.stdin.isTTY) return ask('Passwort: ', false);
  for (;;) {
    const pw = await ask('Passwort (mind. 8 Zeichen, wird nicht angezeigt): ', true);
    if (pw.length < 8) {
      console.log('Zu kurz, bitte mindestens 8 Zeichen.');
      continue;
    }
    if ((await ask('Passwort wiederholen: ', true)) === pw) return pw;
    console.log('Die beiden Eingaben stimmen nicht überein, bitte noch einmal.');
  }
}

const [cmd, ...args] = process.argv.slice(2);
const s = await createServices(configFromEnv());
try {
  switch (cmd) {
    case 'admin:create': {
      const [login, name] = args;
      if (!login || !name) throw new Error('Aufruf: admin:create <kürzel> "<Name>"');
      const id = await s.accounts.create(login, name, await askPassword());
      await s.users.grant(id, await s.contexts.system(), 'admin');
      await s.audit.append({ actorId: null, action: 'cli.admin_created', data: { userId: id } });
      console.log(`Administration angelegt: ${login} (ID ${id})`);
      break;
    }
    case 'admin:password': {
      const [login] = args;
      const row = await s.db.selectFrom('local_accounts').select('user_id').where('login', '=', (login ?? '').toLowerCase()).executeTakeFirst();
      if (!row) throw new Error('Kürzel unbekannt');
      await s.accounts.setPassword(row.user_id, await askPassword());
      await s.sessions.destroyAllFor(row.user_id);
      await s.audit.append({ actorId: null, action: 'cli.password_set', data: { userId: row.user_id } });
      console.log('Passwort gesetzt, alle Sitzungen beendet.');
      break;
    }
    case 'audit:verify': {
      const r = await s.audit.verify();
      console.log(r.ok ? 'Protokollkette unversehrt.' : `Protokollkette gebrochen bei Eintrag ${r.brokenAt}.`);
      process.exitCode = r.ok ? 0 : 2;
      break;
    }
    case 'pinnwand:umziehen': {
      const n = await moveBlobs(s.db, s.pinnwand.media);
      console.log(n ? `${n} Datei(en) in ${s.pinnwand.media.root} umgetragen.` : 'Alle Pinnwand-Medien liegen schon im Ordner.');
      break;
    }
    case 'pinnwand:pruefen': {
      const r = await checkMedia(s.db, s.pinnwand.media);
      console.log(`Pinnwand-Medien in ${s.pinnwand.media.root}: ${r.files} Datei(en).`);
      if (r.inDb) console.log(`${r.inDb} Datei(en) liegen noch in der Datenbank (werden beim Start umgetragen, sofort: pinnwand:umziehen).`);
      for (const m of r.missing) console.log(`FEHLT: ${m.path} (Eintrag ${m.id})`);
      for (const m of r.wrongSize) console.log(`GRÖSSE STIMMT NICHT: ${m.path} (Eintrag ${m.id})`);
      if (r.orphans.length) console.log(`${r.orphans.length} Datei(en) ohne Eintrag (übrig nach Abbrüchen, können gelöscht werden), z. B. ${r.orphans.slice(0, 3).join(', ')}`);
      const ok = !r.missing.length && !r.wrongSize.length;
      console.log(ok ? 'Pinnwand-Medien vollständig.' : 'Pinnwand-Medien unvollständig – bitte aus der Sicherung zurückholen (collegare sichern legt Datenbank und Ordner zusammen ab).');
      process.exitCode = ok ? 0 : 2;
      break;
    }
    default:
      console.log('Befehle: admin:create <kürzel> "<Name>" | admin:password <kürzel> | audit:verify | pinnwand:pruefen | pinnwand:umziehen');
      process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await s.db.destroy();
}
