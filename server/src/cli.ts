/**
 * Verwaltung auf der Kommandozeile (auf der VM als Dienstkonto ausführen):
 *   node dist/cli.js admin:create <kürzel> "<Name>"   – Passwort aus COLLEGARE_PASSWORD oder Eingabe
 *   node dist/cli.js admin:password <kürzel>
 *   node dist/cli.js audit:verify
 */
import { createInterface } from 'node:readline/promises';
import { configFromEnv, createServices } from './services.js';

async function askPassword(): Promise<string> {
  if (process.env.COLLEGARE_PASSWORD) return process.env.COLLEGARE_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question('Passwort (mind. 8 Zeichen): ');
  rl.close();
  return pw;
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
