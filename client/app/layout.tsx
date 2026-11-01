import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Collegare',
  description: 'Kooperative Projektarbeit, Schritt für Schritt',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
