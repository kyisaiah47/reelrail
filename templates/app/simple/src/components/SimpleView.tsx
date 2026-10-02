/* THE SIMPLE VIEW. The outcome first, then the newest clip as a readable result, its sources
 * behind a disclosure, how it was checked behind another, then the archive. Every fact on the
 * page comes from the stored rows; nothing here is typed in. */
import Link from 'next/link';
import type { Entry } from '@/lib/store';
import Sources from '@/components/Sources';
import Disclosure from '@/components/Disclosure';
import './simple.css';

type View = Entry & { video: string | null; dry: boolean };

export default function SimpleView({ entries, publication }: { entries: View[]; publication: string }) {
  const latest = entries[0];
  return (
    <div className="sv-home">
      <section className="sv-hero">
        <div className="sv-pitch">
          <p className="label">{publication.toUpperCase()}</p>
          <h1>Short videos, each one checked against its source.</h1>
          <p>
            Every script on this page was written from a source fetched when the clip was made. Each fact in it quotes that source,
            and the finished video was opened and measured before it was posted.
          </p>
        </div>
        {latest ? (
          <div className="sv-card" id="start">
            <p className="sv-step"><span>THE NEWEST CLIP</span><span>{latest.date}</span></p>
            {latest.video ? <video src={latest.video} controls playsInline preload="metadata" className="player" /> : null}
            {latest.permalink ? <a className="primary" href={latest.permalink}>Watch it on {latest.platform}</a> : null}
            {latest.dry ? <p className="sv-note">This clip came from a dry run. It was rendered and stored and was not posted.</p> : null}
          </div>
        ) : (
          <div className="sv-card"><p>No clips are in the store yet.</p></div>
        )}
      </section>

      {latest ? (
        <section className="sv-section">
          <div className="sv-result">
            <p className="sv-step"><span>WHAT IT SAYS</span><span>#{latest.n}</span></p>
            <h2>{latest.hook}</h2>
            <p className="sv-script">{latest.narration.join(' ')}</p>
            <Disclosure title="Where these facts come from">
              <Sources e={latest} />
            </Disclosure>
            <Disclosure title="How the video was checked">
              <p>
                The finished file was opened after the render. It runs {latest.meta?.verify?.duration?.toFixed(1)} seconds at{' '}
                {latest.meta?.verify?.width}x{latest.meta?.verify?.height}, and its sound averages {latest.meta?.verify?.meanVolume} dB.
              </p>
              {latest.meta?.footage?.length ? (
                <p>Footage: {latest.meta.footage.map((f) => `${f.provider}${f.credit ? ` (${f.credit})` : ''}`).join(', ')}.</p>
              ) : null}
            </Disclosure>
          </div>
        </section>
      ) : null}

      {entries.length > 1 ? (
        <section className="sv-section">
          <h2 className="sv-h2">Earlier clips</h2>
          <ul className="sv-archive">
            {entries.slice(1).map((e) => (
              <li key={e.slug}>
                <Link href={`/entry/${e.slug}`}>{e.hook}</Link>
                <span>{e.date}{e.dry ? ', dry run' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
