/**
 * Zugriff auf den Collegare-Server. Anmeldung über das httpOnly-Cookie (credentials: include),
 * damit kein Token im Browser-Speicher liegt.
 */
import { io, type Socket } from 'socket.io-client';

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
/** Leer im Betrieb (gleicher Ursprung), in der Entwicklung http://localhost:8787 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + BASE_PATH + path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof json.error === 'string' ? json.error : `Fehler ${res.status}`, res.status);
  return json as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T,>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);

export function projectSocket(): Socket {
  return io(API_URL + '/project', { path: BASE_PATH + '/socket.io', withCredentials: true, transports: ['websocket'] });
}

/** Link innerhalb der Oberfläche (statischer Export mit trailingSlash). */
export function href(path: string): string {
  return BASE_PATH + path;
}
