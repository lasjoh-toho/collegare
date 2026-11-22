/**
 * Seitenmenüs (Jo, 22. November 2026): links wie rechts ist immer nur eines offen. Wer ein Seitenmenü öffnet, meldet
 * das hier; alle anderen auf derselben Seite schließen sich. Eingebettete Oberflächen (Pinnwand, Folien aus Bento) hören
 * im iframe auf dieselbe Nachricht und melden ihre eigenen Seitenmenüs ebenso:
 *
 *   window.parent.postMessage({ type: 'collegare:side-open', edge: 'left' | 'right', id: 'pinnwand-ebenen' }, origin)
 *
 * Collegare schickt dieselbe Nachricht an alle iframes der Seite, wenn eines seiner Seitenmenüs aufgeht.
 */
import { useEffect, useRef } from 'react';

export type Edge = 'left' | 'right';
const EVENT = 'collegare:side';
const MSG = 'collegare:side-open';

export function announceSide(edge: Edge, id: string) {
  dispatchEvent(new CustomEvent(EVENT, { detail: { edge, id } }));
  document.querySelectorAll('iframe').forEach((f) => {
    try {
      f.contentWindow?.postMessage({ type: MSG, edge, id }, location.origin);
    } catch {}
  });
}

/**
 * Schließt dieses Seitenmenü, sobald ein anderes auf derselben Seite aufgeht (auch in einem iframe). Das Öffnen selbst
 * meldet der Aufrufer mit announceSide, wenn jemand das Menü aufmacht (nicht beim Wiederherstellen nach dem Laden).
 */
export function useSideBus(edge: Edge, id: string, open: boolean, close: () => void) {
  const state = useRef({ open, close });
  state.current = { open, close };
  useEffect(() => {
    const onSide = (e: Event) => {
      const d = (e as CustomEvent<{ edge: Edge; id: string }>).detail;
      if (d.edge === edge && d.id !== id && state.current.open) state.current.close();
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== MSG || e.data.edge !== edge || e.data.id === id) return;
      // nur Nachrichten aus eingebetteten Oberflächen, nicht die eigene Rundsendung
      if (e.source === window) return;
      if (state.current.open) state.current.close();
    };
    addEventListener(EVENT, onSide);
    addEventListener('message', onMsg);
    return () => {
      removeEventListener(EVENT, onSide);
      removeEventListener('message', onMsg);
    };
  }, [edge, id]);
}
