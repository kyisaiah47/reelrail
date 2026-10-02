import { notFound } from 'next/navigation';
import Link from 'next/link';
import { entry, mediaUrl, isDry } from '@/lib/store';
import Sources from '@/components/Sources';

export const dynamic = 'force-dynamic';

export default async function EntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const e = await entry(slug);
  if (!e) notFound();
  const video = mediaUrl(e, 'video');
  return (
    <main className="page">
      <p className="crumb"><Link href="/">All clips</Link></p>
      <article className="entry">
        {video ? <video src={video} controls playsInline preload="metadata" className="player" /> : null}
        <div>
          <p className="label">{e.date}{e.taxon ? ` · ${e.taxon}` : ''}{isDry(e) ? ' · dry run, not posted' : ''}</p>
          <h1>{e.hook}</h1>
          {e.narration.map((l, i) => <p key={i}>{l}</p>)}
          {e.permalink ? <p><a className="primary" href={e.permalink}>Watch it on {e.platform}</a></p> : null}
          <h2>Sources</h2>
          <Sources e={e} />
        </div>
      </article>
    </main>
  );
}
