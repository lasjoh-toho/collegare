import { DocChangeStore, Documents } from './projects/documents.js';
import { MapStore } from './projects/maps.js';
import { Gradings } from './projects/gradings.js';
import { Materials } from './projects/materials.js';
import { OidcProvider } from './identity/oidcProvider.js';
import { AuditLog } from './audit/auditLog.js';
import { createDb, type Db } from './db/index.js';
import { migrate } from './db/migrations.js';
import { AccessCodes } from './identity/accessCodes.js';
import { LocalAccounts } from './identity/accounts.js';
import { Contexts } from './identity/contexts.js';
import { Sessions } from './identity/sessions.js';
import { Users } from './identity/users.js';
import { Projects } from './projects/projects.js';
import { FrameStore } from './projects/settings.js';
import { Lti } from './lti/lti.js';
import { ToolKeyStore } from './lti/toolKey.js';
import { RateLimiter } from './security/rateLimiter.js';

export interface Config {
  databaseUrl: string;
  /** Öffentliche Adresse inkl. Unterordner, z. B. https://server.schule.de/collegare */
  appUrl: string;
  cookieSecure: boolean;
  /** Lebensdauer eines Lernenden-Zugangscodes in Tagen (Standard 14, ein Projekt dauert Wochen) */
  accessCodeDays: number;
}

export function configFromEnv(env = process.env): Config {
  const appUrl = (env.APP_URL ?? 'http://localhost:8787').replace(/\/$/, '');
  return {
    databaseUrl: env.DATABASE_URL ?? 'sqlite:collegare.sqlite',
    appUrl,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : appUrl.startsWith('https:'),
    accessCodeDays: Number(env.ACCESS_CODE_DAYS ?? 14),
  };
}

export interface Services {
  config: Config;
  db: Db;
  audit: AuditLog;
  users: Users;
  contexts: Contexts;
  sessions: Sessions;
  accounts: LocalAccounts;
  accessCodes: AccessCodes;
  projects: Projects;
  frame: FrameStore;
  maps: MapStore;
  gradings: Gradings;
  materials: Materials;
  oidc: OidcProvider;
  documents: Documents;
  docStore: DocChangeStore;
  lti: Lti;
  toolKey: ToolKeyStore;
  loginLimiter: RateLimiter;
  codeLimiter: RateLimiter;
}

export async function createServices(config: Config, now: () => number = Date.now, fetchFn: typeof fetch = fetch): Promise<Services> {
  const db = await createDb(config.databaseUrl);
  await migrate(db);
  const users = new Users(db, now);
  const contexts = new Contexts(db, now);
  await contexts.system();
  const audit = new AuditLog(db, now);
  const projects = new Projects(db, users, now);
  const maps = new MapStore(db);
  const toolKey = new ToolKeyStore(db);
  const lti = new Lti(db, users, contexts, audit, toolKey, { appUrl: config.appUrl }, now, fetchFn);
  lti.addToProject = (projectId, userId) => projects.addMember(projectId, userId);
  return {
    config,
    db,
    audit,
    users,
    contexts,
    sessions: new Sessions(db, now),
    accounts: new LocalAccounts(db, users, now),
    accessCodes: new AccessCodes(db, now),
    projects,
    frame: new FrameStore(db),
    maps,
    gradings: new Gradings(db, projects, maps, now),
    materials: new Materials(db, now),
    oidc: new OidcProvider(db, toolKey, users, contexts, config.appUrl, now),
    documents: new Documents(db),
    docStore: new DocChangeStore(db),
    lti,
    toolKey,
    loginLimiter: new RateLimiter(10, 10 * 60_000, now),
    codeLimiter: new RateLimiter(10, 10 * 60_000, now),
  };
}
