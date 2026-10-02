'use client';

/* THE CONSOLE. One bar with the publication's counts, then three columns edge to edge: every
 * entry on the left, the chosen entry in the middle (the clip, the script and its sources), and
 * the record on the right (the read-back measurements, the footage credits and the stored row).
 * The chosen entry lives in the URL as ?e=, so a link to an entry is a link to that entry. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Entry } from '@/lib/store';
import './console.css';

type View = Entry & { video: string | null; dry: boolean };

export default function ConsoleView({ entries, publication }: { entries: View[]; publication: string }) {
  const [sel, setSel] = useState(entries[0]?.slug || '');
  const bySlug = useMemo(() => new Map(entries.map((e) => [e.slug, e])), [entries]);
  const e = bySlug.get(sel) || entries[0];

  useEffect(() => {
    const read = () => {
      const k = new URLSearchParams(location.search).get('e');
      if (k && bySlug.has(k)) setSel(k);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [bySlug]);

  const select = useCallback((k: string) => {
    setSel(k);
    const url = new URL(location.href);
    url.searchParams.set('e', k);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);

  const published = entries.filter((x) => !x.dry).length;
  if (!e) {
    return (
      <div className="empty">
        <p>No clips in the store for <b>{publication}</b> yet. Run <code>reelrail run {publication} --slot --dry</code> and reload.</p>
      </div>
    );
  }
  return (
    <>
      <div className="bar">
        <span className="bar-title">{publication}</span>
        <span className="label">{entries.length} entries · {published} posted · {entries.length - published} dry runs</span>
        <span className="label">latest {entries[0]?.date}</span>
      </div>
      <div className="console">
        <aside className="side" aria-label="Entries">
          <div className="side-in">
          <h2 className="label">ENTRIES</h2>
          <nav className="idx">
            {entries.map((x) => (
              <a key={x.slug} href={`/?e=${x.slug}`} aria-current={x.slug === e.slug ? 'true' : undefined}
                onClick={(ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return; ev.preventDefault(); select(x.slug); }}>
                <span>{x.hook}</span>
                <span className={x.dry ? 'tag dry' : 'tag ok'}>{x.dry ? 'dry' : x.platform}</span>
              </a>
            ))}
          </nav>
          </div>
        </aside>
        <main className="river">
          <div className="river-grid">
            {e.video ? <video key={e.slug} src={e.video} controls playsInline preload="metadata" className="player" /> : <div className="player none">No local clip</div>}
            <div>
              <p className="label">#{e.n} · {e.date}{e.taxon ? ` · ${e.taxon}` : ''}{e.meta?.term ? ` · ${e.meta.term}` : ''}</p>
              <h1>{e.hook}</h1>
              <ol className="script">
                {e.narration.map((l, i) => <li key={i}><span className="label">{String(i).padStart(2, '0')}</span>{l}</li>)}
              </ol>
              {e.meta?.midcard ? (
                <div className="midcard">
                  <p className="label">MID-ROLL CARD</p>
                  <p><b>{e.meta.midcard.title}</b></p>
                  <ul>{e.meta.midcard.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
              ) : null}
              <p className="caption"><span className="label">CAPTION</span> {e.caption}</p>
            </div>
          </div>
          <section className="block">
            <h2 className="label">SOURCES AND EVIDENCE</h2>
            <div className="sources">
              <ul>{(e.sources || []).map((s) => <li key={s.url}><a href={s.permalink || s.url}>{s.title}</a> <span>{s.revisionId ? `rev ${s.revisionId}` : ''} {s.retrievedAt?.slice(0, 10)}</span></li>)}</ul>
              <dl>{(e.meta?.evidence || []).map((ev, i) => <div key={i}><dt>{ev.claim}</dt><dd>&ldquo;{ev.quote}&rdquo;</dd></div>)}</dl>
            </div>
          </section>
        </main>
        <aside className="side side-r" aria-label="The record">
          <div className="side-in">
          <h2 className="label">READ-BACK</h2>
          <dl className="facts">
            <div><dt>duration</dt><dd>{e.meta?.verify?.duration?.toFixed(2)} s</dd></div>
            <div><dt>frame</dt><dd>{e.meta?.verify?.width}x{e.meta?.verify?.height} at {e.meta?.verify?.fps} fps</dd></div>
            <div><dt>loudness</dt><dd>{e.meta?.verify?.meanVolume} dB mean</dd></div>
            <div><dt>size</dt><dd>{e.meta?.verify ? `${(e.meta.verify.bytes / 1e6).toFixed(1)} MB` : ''}</dd></div>
          </dl>
          <h2 className="label">POST</h2>
          <dl className="facts">
            <div><dt>platform</dt><dd>{e.platform || 'not posted'}</dd></div>
            <div><dt>permalink</dt><dd>{e.permalink ? <a href={e.permalink}>open</a> : 'none'}</dd></div>
          </dl>
          <h2 className="label">FOOTAGE</h2>
          <ul className="credits">{(e.meta?.footage || []).map((f) => <li key={`${f.provider}-${f.id}`}>{f.provider} {f.id}{f.credit ? ` by ${f.credit}` : ''}</li>)}</ul>
          <details className="raw"><summary className="label">STORED ROW</summary><pre>{JSON.stringify({ ...e, video: undefined, dry: undefined }, null, 1)}</pre></details>
          </div>
        </aside>
      </div>
    </>
  );
}
