'use client';
/**
 * Zugang mit Code oder QR. Gleiche Seite wie der Start (Code-Karte oben), nur ohne Login für Lehrkräfte;
 * der QR-Code auf dem Zettel führt hierher (#k=…).
 */
import { Welcome } from '@/components/Welcome';

export default function Zugang() {
  return <Welcome showLogin={false} />;
}
