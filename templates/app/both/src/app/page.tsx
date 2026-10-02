import ConsoleView from '@/components/ConsoleView';
import SimpleView from '@/components/SimpleView';
import PageViews from '@/components/site-view/PageViews';
import { PUBLICATION } from '@/lib/store';
import { viewEntries } from '@/lib/views';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const list = await viewEntries();
  return <PageViews consoleView={<ConsoleView entries={list} publication={PUBLICATION} />} simpleView={<SimpleView entries={list} publication={PUBLICATION} />} />;
}
