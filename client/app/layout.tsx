import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Collegare',
  description: 'Kooperative Projektarbeit, Schritt für Schritt',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Tag/Nacht vor dem ersten Zeichnen setzen, damit nichts aufblitzt (Wahl aus lib/theme.ts). */
const THEME_SCRIPT = `try{var t=localStorage.getItem('collegare-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
