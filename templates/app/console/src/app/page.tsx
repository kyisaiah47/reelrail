import ConsoleView from '@/components/ConsoleView';
import { PUBLICATION } from '@/lib/store';
import { viewEntries } from '@/lib/views';

export const dynamic = 'force-dynamic';

export default async function Home() {
  return <ConsoleView entries={await viewEntries()} publication={PUBLICATION} />;
}
