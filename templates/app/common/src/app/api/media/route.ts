// Streams a clip or a still that a JSON store points at on local disk. It serves only the exact
// paths stored on an entry, never a path from the request.
import fs from 'node:fs';
import { entry, fromStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const e = await entry(q.get('entry') || '');
  const kind = q.get('kind') === 'still' ? 'still' : 'video';
  const stored = e ? (kind === 'video' ? e.meta?.video : e.still) : null;
  const file = stored && !/^https?:/.test(stored) ? fromStore(stored) : null;
  if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
  const body = fs.readFileSync(file);
  return new Response(body, {
    headers: { 'content-type': kind === 'video' ? 'video/mp4' : 'image/jpeg', 'content-length': String(body.length), 'cache-control': 'public, max-age=3600' },
  });
}
