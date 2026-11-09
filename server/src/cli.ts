/**
 * Verwaltung auf der Kommandozeile (auf der VM als Dienstkonto ausführen):
 *   node dist/cli.js admin:create <kürzel> "<Name>"   – Passwort aus COLLEGARE_PASSWORD oder Eingabe
 *   node dist/cli.js admin:password <kürzel>
 *   node dist/cli.js audit:verify
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { configFromEnv, createServices } from './services.js';

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
    default:
      console.log('Befehle: admin:create <kürzel> "<Name>" | admin:password <kürzel> | audit:verify');
      process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await s.db.destroy();
}
