// The rows a page renders: published entries, with where to load each clip and whether it was a dry run.
import 'server-only';
import { entries, mediaUrl, isDry, type Entry } from './store';

export type ViewEntry = Entry & { video: string | null; dry: boolean };

export async function viewEntries(): Promise<ViewEntry[]> {
  return (await entries()).map((e) => ({ ...e, video: mediaUrl(e, 'video'), dry: isDry(e) }));
}
