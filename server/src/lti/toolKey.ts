/**
 * Schlüsselpaar von Collegare für LTI (Signatur der Client-Assertion bei NRPS/AGS).
 * Wird beim ersten Gebrauch erzeugt und in kv gespeichert; der öffentliche Teil steht unter /lti/jwks.
 */
import { exportJWK, generateKeyPair, importJWK, type JWK, type CryptoKey } from 'jose';
import type { Db } from '../db/index.js';

const KEY = 'lti_tool_key';

export interface ToolKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export class ToolKeyStore {
  private cached: Promise<ToolKey> | null = null;
  constructor(private db: Db) {}

  get(): Promise<ToolKey> {
    this.cached ??= this.load().catch((e) => {
      this.cached = null;
      throw e;
    });
    return this.cached;
  }

  private async load(): Promise<ToolKey> {
    const row = await this.db.selectFrom('kv').select('v').where('k', '=', KEY).executeTakeFirst();
    if (row) {
      const { kid, priv, pub } = JSON.parse(row.v) as { kid: string; priv: JWK; pub: JWK };
      return { kid, privateKey: (await importJWK(priv, 'RS256')) as CryptoKey, publicJwk: { ...pub, kid, alg: 'RS256', use: 'sig' } };
    }
    const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    const kid = 'collegare-' + new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 8);
    const priv = await exportJWK(privateKey);
    const pub = await exportJWK(publicKey);
    try {
      await this.db.insertInto('kv').values({ k: KEY, v: JSON.stringify({ kid, priv, pub }) }).execute();
    } catch {
      // gleichzeitig erzeugt: den gespeicherten nehmen
      return this.load();
    }
    return { kid, privateKey, publicJwk: { ...pub, kid, alg: 'RS256', use: 'sig' } };
  }
}
