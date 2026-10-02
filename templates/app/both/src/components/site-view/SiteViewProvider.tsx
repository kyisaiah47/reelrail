'use client';

/* WHICH VIEW THIS VISITOR IS READING: Console or Simple.
 *
 * Console is the clean-visitor default. A valid `?view=simple|console` wins over the saved
 * choice, and a valid explicit choice is saved. Only the preference reaches localStorage, under
 * `<publication>:view`. Switching keeps the route, the hash and every other query parameter. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Welcome, { type WelcomeExample } from './Welcome';
import './site-view.css';

export type SiteView = 'console' | 'simple';

interface ViewContext {
  view: SiteView;
  choose: (view: SiteView) => void;
  welcome: () => void;
  product: string;
}

const Context = createContext<ViewContext | null>(null);
export const useSiteView = () => useContext(Context);
export const welcomeEvent = (product: string) => `${product}:welcome`;

export default function SiteViewProvider({ product, example, children }: { product: string; example: WelcomeExample | null; children: ReactNode }) {
  const [view, setView] = useState<SiteView>('console');
  const path = usePathname();
  const VIEW_KEY = `${product}:view`;

  const choose = useCallback((next: SiteView) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* a blocked store never breaks the switch */ }
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', next);
      window.history.replaceState(window.history.state, '', url.href);
    }
  }, [VIEW_KEY]);

  useEffect(() => {
    const explicit = new URLSearchParams(window.location.search).get('view');
    if (explicit === 'simple' || explicit === 'console') choose(explicit);
    else {
      let saved: SiteView = 'console';
      try { saved = localStorage.getItem(VIEW_KEY) === 'simple' ? 'simple' : 'console'; } catch { /* storage blocked */ }
      setView(saved);
    }
  }, [path, choose, VIEW_KEY]);

  useEffect(() => { document.documentElement.dataset.view = view; }, [view]);

  const welcome = useCallback(() => window.dispatchEvent(new Event(welcomeEvent(product))), [product]);

  return (
    <Context.Provider value={{ view, choose, welcome, product }}>
      {children}
      <Welcome example={example} />
    </Context.Provider>
  );
}
