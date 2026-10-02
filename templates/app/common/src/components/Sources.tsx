// The sources a clip's script was checked against, and the quotes each claim rests on.
import type { Entry } from '@/lib/store';

export default function Sources({ e }: { e: Entry }) {
  return (
    <div className="sources">
      {e.sources?.length ? (
        <ul>
          {e.sources.map((s) => (
            <li key={s.url}>
              <a href={s.permalink || s.url}>{s.title}</a>
              <span>
                {s.revisionId ? ` revision ${s.revisionId}` : ''}
                {s.retrievedAt ? `, fetched ${s.retrievedAt.slice(0, 10)}` : ''}
                {s.license ? `, ${s.license}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>This clip was written without a fetched source.</p>
      )}
      {e.meta?.evidence?.length ? (
        <dl>
          {e.meta.evidence.map((ev, i) => (
            <div key={i}>
              <dt>{ev.claim}</dt>
              <dd>&ldquo;{ev.quote}&rdquo;</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
