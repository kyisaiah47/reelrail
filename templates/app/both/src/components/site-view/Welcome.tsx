'use client';

/* START HERE. What this site is, one labelled illustration of its output, and the choice of view.
 * Opens by itself on `/` unless the visitor turned it off (`<publication>:welcome-off`) or
 * `?welcome=0` is present. Closing or choosing never turns it off; the checkbox does. Escape and
 * a click on the backdrop close it. The illustration is the newest stored clip's first evidence
 * pair: a line the clip says and the source sentence it rests on. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSiteView, welcomeEvent, type SiteView } from './SiteViewProvider';

export interface WelcomeExample { claim: string; quote: string; source: string; date: string }

export default function Welcome({ example }: { example: WelcomeExample | null }) {
  const mode = useSiteView();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const [off, setOff] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const OFF_KEY = `${mode?.product}:welcome-off`;

  const readOff = useCallback(() => {
    try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; }
  }, [OFF_KEY]);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOff(readOff());
    const el = dialog.current;
    if (!el) return;
    setMounted(true);
    if (!el.open) {
      previous.current = document.activeElement as HTMLElement | null;
      el.showModal();
    }
    requestAnimationFrame(() => {
      setVisible(true);
      if (!el.contains(document.activeElement) || document.activeElement === el) el.querySelector<HTMLElement>('.sv-welcome-top > button')?.focus();
    });
  }, [readOff]);

  const close = useCallback(() => {
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = setTimeout(() => {
      dialog.current?.close();
      setMounted(false);
      const back = previous.current;
      if (back && back.isConnected && back !== document.body) back.focus();
      else document.querySelector<HTMLElement>('.head .brand')?.focus({ preventScroll: true });
    }, reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (path === '/' && !readOff() && q.get('welcome') !== '0') show();
    const ev = welcomeEvent(mode?.product || '');
    window.addEventListener(ev, show);
    return () => {
      window.removeEventListener(ev, show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, show, readOff, mode?.product]);

  function select(view: SiteView) {
    mode?.choose(view);
    close();
  }

  return (
    <dialog ref={dialog} className="sv-welcome" data-visible={visible} aria-labelledby="sv-welcome-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) close(); }}>
      {mounted ? (
        <>
          <header className="sv-welcome-top">
            <span>{mode?.product} <small>/ START HERE</small></span>
            <button type="button" aria-label="Close welcome" onClick={close} autoFocus>×</button>
          </header>
          <div className="sv-welcome-intro">
            <h2 id="sv-welcome-title">Where do these videos get their facts?</h2>
            <p>
              Each short video here was written from a source fetched when it was made. Every fact in the script quotes that
              source, and the finished file was opened and measured before it went out.
            </p>
          </div>
          {example ? (
            <section className="sv-illustration" aria-label="Illustration of one checked line">
              <div><span>ONE LINE. ONE SOURCE SENTENCE.</span><span>ILLUSTRATION</span></div>
              <p>The video says:</p>
              <blockquote>{example.claim}</blockquote>
              <p>The source{example.source ? `, ${example.source},` : ''} says:</p>
              <blockquote className="sv-illustration-quote">{example.quote}</blockquote>
              <p>Both come from the newest clip in the store{example.date ? `, made on ${example.date}` : ''}.</p>
            </section>
          ) : null}
          <section className="sv-welcome-choose">
            <div>
              <h3>How would you like to explore?</h3>
              <p>You can switch anytime.</p>
            </div>
            <div className="sv-choices">
              <button type="button" onClick={() => select('console')}>
                <span><b>Console</b></span>
                <strong>See more at once.</strong>
                <span>A compact layout with every clip, its script, its sources and its measurements on screen.</span>
              </button>
              <button type="button" onClick={() => select('simple')}>
                <span><b>Simple</b></span>
                <strong>Start with the essentials.</strong>
                <span>The newest clip and what it says, with the details you can open as you go.</span>
              </button>
            </div>
          </section>
          <footer>
            <label>
              <input type="checkbox" checked={off} onChange={(e) => {
                const value = e.target.checked;
                setOff(value);
                try { if (value) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* lasts this visit */ }
              }} />
              Don&rsquo;t open this when I come back
            </label>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}
