'use client';
/**
 * „Bild aufnehmen“ (Wunsch Jo, 24. November 2026): der Dokumentenscanner aus Autogra.fi (client/public/scanner,
 * Eckenerkennung, Entzerren, Unschärfe-Warnung) im ganzen Fenster. Er schickt das fertige Bild per postMessage
 * zurück; Farben bleiben, wie sie sind (aufbereitet wird erst vor der Texterkennung, lib/ocr.ts).
 */
import { useEffect } from 'react';
import { href } from '@/lib/api';

export function ScanDialog({ onImage, onClose, max = 1 }: { onImage: (f: File) => void; onClose: () => void; max?: number }) {
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'collegare-scan-close') onClose();
      if (e.data.type === 'collegare-scan' && Array.isArray(e.data.images)) {
        const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
        (e.data.images as Blob[]).slice(0, max).forEach((b, i) => onImage(new File([b], `aufnahme-${stamp}${i ? '-' + (i + 1) : ''}.jpg`, { type: 'image/jpeg' })));
        onClose();
      }
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('message', on);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('message', on);
      window.removeEventListener('keydown', esc);
    };
  }, [onImage, onClose, max]);

  return (
    // modal-bg: der Notiz-Editor wertet Klicks hier nicht als „daneben“ (speichern)
    <div className="modal-bg" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', padding: 0 }} data-recording="">
      <iframe src={href(`/scanner/index.html?max=${max}&kamera=1`)} title="Bild aufnehmen" allow="camera; fullscreen" style={{ border: 0, width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}
