// THE OPTIONAL BROWSER TRANSPORT. A plain Playwright session on a browser profile you signed into
// yourself, for a platform or account the official API does not cover. It opens the upload page,
// sets the file, types the caption and presses the post button, using selectors you supply.
//
// It carries no bypass code of any kind. It does not hide that it is automated, it does not alter
// browser fingerprints, and it does not touch a captcha or a sign-in form. When the page shows a
// captcha, a sign-in wall or a block, the transport stops and returns a platform signal, and the
// slot ends there. Each platform's terms of service apply to whoever runs it.
//
//   outputs.primary.transport: "browser"
//   outputs.primary.browser: {
//     "profileDir": "/path/to/a/profile/you/signed/into",
//     "uploadUrl": "https://...",
//     "selectors": { "file": "input[type=file]", "caption": "...", "post": "...", "success": "...",
//                    "signedOut": "...", "captcha": "..." },
//     "headless": false
//   }
//
// launchSafe() runs the browser muted and installs a capturing click guard on every page: a click
// on a link whose scheme is not http or https (mailto:, tel:, an app scheme) is cancelled and
// recorded on window.__blockedExternalHrefs, so an upload page can never open a desktop app.
// Needs the optional peer dependency playwright-core and a browser it can launch.
import { raise, raiseSignal } from '../envelope.js';

const CLICK_GUARD = `(() => {
  window.__blockedExternalHrefs = [];
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.__blockedExternalHrefs.push(href);
    }
  }, true);
})();`;

async function visible(page, selector) {
  if (!selector) return false;
  try { return (await page.locator(selector).count()) > 0 && await page.locator(selector).first().isVisible(); } catch { return false; }
}

export async function launchSafe(opts) {
  let pw;
  try { pw = await import('playwright-core'); } catch {
    raise('config_invalid', 'the browser transport needs the optional dependency playwright-core: npm i playwright-core');
  }
  const ctx = await pw.chromium.launchPersistentContext(opts.profileDir, {
    headless: opts.headless ?? false,
    executablePath: opts.executablePath,
    channel: opts.channel,
    args: ['--mute-audio'],
  });
  await ctx.addInitScript(CLICK_GUARD);
  return { ctx, page: ctx.pages()[0] || await ctx.newPage(), close: () => ctx.close() };
}

export async function publishBrowser({ video, caption, opts = {}, open = launchSafe }) {
  const sel = opts.selectors || {};
  for (const k of ['caption', 'post', 'success']) if (!sel[k]) raise('config_invalid', `outputs.primary.browser.selectors.${k} is required`);
  if (!opts.profileDir || !opts.uploadUrl) raise('config_invalid', 'outputs.primary.browser needs profileDir and uploadUrl');
  const session = await open(opts);
  const { page } = session;
  try {
    await page.goto(opts.uploadUrl, { waitUntil: 'domcontentloaded', timeout: opts.navTimeoutMs || 60000 });
    const stopIfBlocked = async (when) => {
      if (await visible(page, sel.captcha)) raiseSignal('captcha', `a captcha appeared ${when}`, 'Open the profile by hand and clear it.');
      if (await visible(page, sel.signedOut)) raiseSignal('signed_out', `the profile is signed out ${when}`, 'Sign in to the profile by hand.');
    };
    await stopIfBlocked('on the upload page');
    await page.locator(sel.file || 'input[type="file"]').first().setInputFiles(video);
    await page.locator(sel.caption).first().waitFor({ timeout: opts.readyTimeoutMs || 120000 });
    await stopIfBlocked('after the file was set');
    await page.locator(sel.caption).first().focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(caption, { delay: 15 });
    await page.locator(sel.post).first().click({ timeout: opts.postTimeoutMs || 120000 });
    try {
      await page.locator(sel.success).first().waitFor({ timeout: opts.successTimeoutMs || 300000 });
    } catch {
      await stopIfBlocked('after posting');
      raise('publish_failed', 'the success marker never appeared after the post button was pressed');
    }
    return { postId: null, url: opts.profileUrl || null, account: opts.handle || null };
  } finally {
    await session.close().catch(() => {});
  }
}
