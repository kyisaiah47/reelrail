// Reads the publication's store on the server. The same rows the engine writes: one per clip, in
// the publication_posts shape. Nothing here writes.
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

export interface Citation { url: string; title: string; permalink?: string; revisionId?: number | null; retrievedAt?: string; license?: string }
export interface Evidence { claim: string; quote: string }
export interface Entry {
  publication: string;
  slug: string;
  n: number;
  hook: string;
  narration: string[];
  beats: string[];
  caption: string;
  published: boolean;
  date: string | null;
  ts: number;
  taxon: string | null;
  still: string | null;
  permalink: string | null;
  platform: string | null;
  sources: Citation[];
  meta: {
    term?: string | null;
    midcard?: { title: string; points: string[] } | null;
    evidence?: Evidence[];
    video?: string;
    duration?: number;
    verify?: { duration: number; width: number; height: number; fps: number; meanVolume: number | null; bytes: number } | null;
    footage?: { provider: string; id: string; credit: string | null; url: string | null; license: string }[];
  };
}

export const PUBLICATION = process.env.REELRAIL_PUBLICATION || '__PUBLICATION__';

/** A JSON store writes its paths relative to its own file. */
export const STORE_FILE = path.resolve(process.cwd(), process.env.REELRAIL_STORE_PATH || '__STORE_PATH__');
export const fromStore = (p: string) => (path.isAbsolute(p) ? p : path.resolve(path.dirname(STORE_FILE), p));

function readJsonStore(): Entry[] {
  try {
    const db = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as { entries: Entry[] };
    return db.entries || [];
  } catch {
    return [];
  }
}

async function readSupabase(): Promise<Entry[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const table = process.env.REELRAIL_TABLE || 'publication_posts';
  const res = await fetch(`${url}/rest/v1/${table}?publication=eq.${encodeURIComponent(PUBLICATION)}&order=ts.desc&limit=200`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    next: { revalidate: 300 },
  });
  return res.ok ? ((await res.json()) as Entry[]) : [];
}

/** Every entry for this publication, newest first. Only published rows unless `all` is set. */
export async function entries({ all = false } = {}): Promise<Entry[]> {
  const rows = process.env.REELRAIL_STORE_KIND === 'supabase' ? await readSupabase() : readJsonStore();
  return rows
    .filter((e) => e.publication === PUBLICATION && (all || e.published))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export async function entry(slug: string): Promise<Entry | null> {
  return (await entries({ all: true })).find((e) => e.slug === slug) || null;
}

/** A dry run is published to the dry transport only. The pages label it. */
export const isDry = (e: Entry) => String(e.platform || '').endsWith(':dry');

/** Where the page can load the clip and the still from. Local files go through /api/media. */
export function mediaUrl(e: Entry, kind: 'video' | 'still'): string | null {
  const value = kind === 'video' ? e.meta?.video : e.still;
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  return `/api/media?entry=${encodeURIComponent(e.slug)}&kind=${kind}`;
}
