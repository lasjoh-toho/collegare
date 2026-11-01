'use client';
import { useEffect, useState } from 'react';
import { ApiError, get } from './api';
import type { Me } from './types';

/** Angemeldete Person; null = nicht angemeldet, undefined = lädt noch. */
export function useMe(): [Me | null | undefined, () => void] {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [n, setN] = useState(0);
  useEffect(() => {
    get<Me>('/api/me')
      .then(setMe)
      .catch((e) => setMe(e instanceof ApiError && e.status === 401 ? null : null));
  }, [n]);
  return [me, () => setN((x) => x + 1)];
}

export function useQuery(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => setV(new URLSearchParams(location.search).get(name)), [name]);
  return v;
}
