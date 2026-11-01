import type { Db } from '../db/index.js';

export class Contexts {
  constructor(private db: Db, private now: () => number = Date.now) {}

  async system(): Promise<number> {
    const sys = await this.db.selectFrom('contexts').select('id').where('kind', '=', 'system').executeTakeFirst();
    if (sys) return sys.id;
    const res = await this.db.insertInto('contexts').values({ kind: 'system', parent_id: null, title: 'Collegare', lti_platform_id: null, lti_context_id: null, nrps_url: null, created_at: this.now() }).executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async create(kind: 'school' | 'course', parentId: number, title: string): Promise<number> {
    const res = await this.db.insertInto('contexts').values({ kind, parent_id: parentId, title, lti_platform_id: null, lti_context_id: null, nrps_url: null, created_at: this.now() }).executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  /** Kurs aus Moodle: je Plattform und LTI-Kontext-ID genau ein Kurs-Kontext. */
  async ltiCourse(platformId: number, ltiContextId: string, title: string, parentId: number): Promise<number> {
    const found = await this.db.selectFrom('contexts').select(['id', 'title']).where('lti_platform_id', '=', platformId).where('lti_context_id', '=', ltiContextId).executeTakeFirst();
    if (found) {
      if (title && title !== found.title) await this.db.updateTable('contexts').set({ title }).where('id', '=', found.id).execute();
      return found.id;
    }
    const res = await this.db
      .insertInto('contexts')
      .values({ kind: 'course', parent_id: parentId, title: title || 'Moodle-Kurs', lti_platform_id: platformId, lti_context_id: ltiContextId, nrps_url: null, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async get(id: number) {
    return this.db.selectFrom('contexts').selectAll().where('id', '=', id).executeTakeFirst();
  }
}
