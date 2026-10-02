// Publishing through the official APIs, against a fake fetch. No real account is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publishTikTok } from '../src/publish/tiktok.js';
import { publishYouTube } from '../src/publish/youtube.js';
import { publishBrowser } from '../src/publish/browser.js';
import { publishDry } from '../src/publish/dry.js';
import { guard } from '../src/envelope.js';
import publishStation from '../src/stations/publish.js';
import { fakeFetch, tmpdir, makeConfig } from './helpers.js';

const video = () => { const f = path.join(tmpdir(), 'v.mp4'); fs.writeFileSync(f, Buffer.alloc(2048, 7)); return f; };
const tiktokEnv = { TIKTOK_ACCESS_TOKEN: 'placeholder' };

const tiktokRoutes = ({ username = 'testpub', status = 'PUBLISH_COMPLETE', initError = null } = {}) => [
  [(u) => u.endsWith('/creator_info/query/'), () => ({ json: { data: { creator_username: username, privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'] }, error: { code: 'ok' } } })],
  [(u) => u.endsWith('/video/init/'), () => (initError ? { status: 403, json: { error: { code: initError, message: 'no' } } } : { json: { data: { publish_id: 'pub1', upload_url: 'http://upload.local/u' }, error: { code: 'ok' } } })],
  [(u) => u === 'http://upload.local/u', () => ({ status: 201 })],
  [(u) => u.endsWith('/status/fetch/'), () => ({ json: { data: { status, publicaly_available_post_id: [777], fail_reason: status === 'FAILED' ? 'spam_risk_too_many_posts' : undefined }, error: { code: 'ok' } } })],
];

test('tiktok: creator check, init, upload, then the post URL', async () => {
  const f = fakeFetch(tiktokRoutes());
  const res = await publishTikTok({ video: video(), caption: 'hello #brain', handle: '@testpub', fetch: f, env: tiktokEnv, sleep: async () => {} });
  assert.equal(res.url, 'https://www.tiktok.com/@testpub/video/777');
  const init = JSON.parse(f.calls[1].init.body);
  assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(init.source_info.source, 'FILE_UPLOAD');
  assert.equal(init.source_info.video_size, 2048);
  assert.equal(f.calls[2].init.headers['content-range'], 'bytes 0-2047/2048');
});

test('tiktok: a different signed-in account is a platform signal and nothing uploads', async () => {
  const f = fakeFetch(tiktokRoutes({ username: 'someone-else' }));
  const env = await guard(() => publishTikTok({ video: video(), caption: 'c', handle: '@testpub', fetch: f, env: tiktokEnv }));
  assert.equal(env.code, 'platform_signal');
  assert.equal(env.meta.signal, 'identity_mismatch');
  assert.equal(f.calls.length, 1);
});

test('tiktok: a spam-risk refusal is a platform signal', async () => {
  const env = await guard(() => publishTikTok({ video: video(), caption: 'c', handle: '@testpub', fetch: fakeFetch(tiktokRoutes({ initError: 'spam_risk_too_many_posts' })), env: tiktokEnv }));
  assert.equal(env.code, 'platform_signal');
  assert.equal(env.meta.signal, 'spam_risk_too_many_posts');
});

const ytRoutes = ({ handle = '@testpub', initStatus = 200, reason = '' } = {}) => [
  [(u) => u === 'https://oauth2.googleapis.com/token', () => ({ json: { access_token: 'at' } })],
  [(u) => u.includes('/youtube/v3/channels'), () => ({ json: { items: [{ id: 'UC1', snippet: { customUrl: handle } }] } })],
  [(u) => u.includes('uploadType=resumable'), () => (initStatus === 200 ? { headers: { location: 'http://upload.local/yt' } } : { status: initStatus, json: { error: { errors: [{ reason }] } } })],
  [(u) => u === 'http://upload.local/yt', () => ({ json: { id: 'vid1' } })],
];
const ytEnv = { YOUTUBE_CLIENT_ID: 'id', YOUTUBE_CLIENT_SECRET: 'placeholder', YOUTUBE_REFRESH_TOKEN: 'placeholder' };

test('youtube: token refresh, channel check, resumable upload, Shorts URL', async () => {
  const f = fakeFetch(ytRoutes());
  const res = await publishYouTube({ video: video(), title: 'A title', description: 'c #brain', handle: '@testpub', fetch: f, env: ytEnv });
  assert.equal(res.url, 'https://www.youtube.com/shorts/vid1');
  const meta = JSON.parse(f.calls[2].init.body);
  assert.equal(meta.status.privacyStatus, 'private');
  assert.equal(f.calls[2].init.headers['x-upload-content-length'], '2048');
});

test('youtube: an exhausted quota is a platform signal', async () => {
  const env = await guard(() => publishYouTube({ video: video(), title: 't', description: 'd', handle: '@testpub', fetch: fakeFetch(ytRoutes({ initStatus: 403, reason: 'quotaExceeded' })), env: ytEnv }));
  assert.equal(env.code, 'platform_signal');
  assert.equal(env.meta.signal, 'quotaExceeded');
});

test('youtube: a revoked refresh token is a platform signal', async () => {
  const f = fakeFetch([[(u) => u.includes('oauth2'), () => ({ status: 400, json: { error: 'invalid_grant' } })]]);
  const env = await guard(() => publishYouTube({ video: video(), title: 't', description: 'd', handle: '@x', fetch: f, env: ytEnv }));
  assert.equal(env.meta.signal, 'auth_revoked');
});

test('dry transport: a receipt with the file hash, and no network', async () => {
  const dir = tmpdir();
  const res = await publishDry({ video: video(), caption: 'c', title: 't', platform: 'tiktok', handle: '@x', entryId: 'e1', receiptsDir: dir });
  const receipt = JSON.parse(fs.readFileSync(res.receipt, 'utf8'));
  assert.equal(receipt.bytes, 2048);
  assert.equal(receipt.sha256.length, 64);
  assert.ok(res.postId.startsWith('dry-'));
});

/** A page object with the calls the browser transport makes. */
function fakePage({ visible = {} } = {}) {
  const log = [];
  const loc = (sel) => ({
    first: () => loc(sel),
    count: async () => (visible[sel] ? 1 : 0),
    isVisible: async () => Boolean(visible[sel]),
    setInputFiles: async (f) => log.push(['file', sel, f]),
    waitFor: async () => { if (visible[sel] === false) throw new Error('timeout'); },
    focus: async () => log.push(['focus', sel]),
    click: async () => log.push(['click', sel]),
  });
  return { log, page: { goto: async (u) => log.push(['goto', u]), locator: loc, keyboard: { press: async () => {}, type: async (t) => log.push(['type', t]) } } };
}
const browserOpts = { profileDir: '/tmp/profile', uploadUrl: 'https://upload.example.org', selectors: { caption: '#cap', post: '#post', success: '#done', captcha: '#captcha', signedOut: '#login' } };

test('browser transport: sets the file, types the caption, presses post', async () => {
  const { page, log } = fakePage();
  const res = await publishBrowser({ video: '/v.mp4', caption: 'hello', opts: browserOpts, open: async () => ({ page, close: async () => {} }) });
  assert.ok(res);
  assert.deepEqual(log.map((l) => l[0]), ['goto', 'file', 'focus', 'type', 'click']);
});

test('browser transport: a captcha stops the slot with a platform signal and is never touched', async () => {
  const { page, log } = fakePage({ visible: { '#captcha': true } });
  const env = await guard(() => publishBrowser({ video: '/v.mp4', caption: 'c', opts: browserOpts, open: async () => ({ page, close: async () => {} }) }));
  assert.equal(env.code, 'platform_signal');
  assert.equal(env.meta.signal, 'captcha');
  assert.equal(log.filter((l) => l[0] === 'click').length, 0);
});

test('publish station: the caption is refused if it carries a link, and nothing is appended', async () => {
  const { cfg } = makeConfig();
  const bad = await publishStation.execute({ entryId: 'e', video: video(), draft: { hook: 'h', caption: 'see https://example.org' } }, cfg, { dry: true, stationOnly: true });
  assert.equal(bad.code, 'gate_refused');
  const good = await publishStation.execute({ entryId: 'e', video: video(), draft: { hook: 'h', caption: 'plain caption #brain' } }, cfg, { dry: true, stationOnly: true });
  assert.equal(good.ok, true);
  const receipt = JSON.parse(fs.readFileSync(good.data.receipt, 'utf8'));
  assert.equal(receipt.caption, 'plain caption #brain');
});
