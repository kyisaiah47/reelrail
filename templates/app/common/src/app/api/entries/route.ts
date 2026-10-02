// The publication's entries as JSON, for anything else that wants to read the store.
import { entries } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ entries: await entries() });
}
