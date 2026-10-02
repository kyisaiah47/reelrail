import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLICATION } from '@/lib/store';
import { viewEntries } from '@/lib/views';
import SiteViewProvider from '@/components/site-view/SiteViewProvider';
import ViewControls from '@/components/site-view/ViewControls';
import './globals.css';

export const metadata: Metadata = { title: PUBLICATION, description: `Short videos from ${PUBLICATION}, each checked against its source.` };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const latest = (await viewEntries())[0];
  const ev = latest?.meta?.evidence?.[0];
  const example = ev ? { claim: ev.claim, quote: ev.quote, source: latest.sources?.[0]?.title || '', date: latest.date || '' } : null;
  return (
    <html lang="en">
      <body>
        <SiteViewProvider product={PUBLICATION} example={example}>
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
            <ViewControls />
          </footer>
        </SiteViewProvider>
      </body>
    </html>
  );
}
