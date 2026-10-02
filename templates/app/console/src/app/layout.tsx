import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLICATION } from '@/lib/store';
import './globals.css';

export const metadata: Metadata = { title: PUBLICATION, description: `Short videos from ${PUBLICATION}, each checked against its source.` };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="head">
          <Link className="brand" href="/">{PUBLICATION}</Link>
          <nav aria-label="Main navigation">
            <Link href="/">Clips</Link>
            <a href="/api/entries">JSON</a>
          </nav>
        </header>
        {children}
        <footer className="foot">
          <span>{PUBLICATION}</span>
        </footer>
      </body>
    </html>
  );
}
