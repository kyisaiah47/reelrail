import SimpleView from '@/components/SimpleView';
import { PUBLICATION } from '@/lib/store';
import { viewEntries } from '@/lib/views';

export const dynamic = 'force-dynamic';

export default async function Home() {
  return <SimpleView entries={await viewEntries()} publication={PUBLICATION} />;
}
