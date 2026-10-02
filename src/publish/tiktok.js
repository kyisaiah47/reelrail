// TikTok, through the official Content Posting API (Direct Post, FILE_UPLOAD).
//
// Auth: a TikTok developer app of your own with the video.publish scope and a user access token
// in TIKTOK_ACCESS_TOKEN, or TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET and TIKTOK_REFRESH_TOKEN
// to refresh one. Until TikTok audits the app, posts can only be private (SELF_ONLY); that is
// TikTok's rule, and outputs.primary.privacy must be one of the levels the account offers.
//
// Before any upload, creator_info is read and its username compared with outputs.primary.handle.
// A mismatch is a platform signal and nothing is uploaded.
import fs from 'node:fs';
import { raise, raiseSignal } from '../envelope.js';

const API = 'https://open.tiktokapis.com/v2';
const SIGNALS = new Set([
  'access_token_invalid', 'scope_not_authorized', 'scope_permission_missed', 'rate_limit_exceeded',
  'spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'spam_risk_too_many_pending_share',
  'reached_active_user_cap', 'unaudited_client_can_only_post_to_private_accounts', 'user_banned_from_posting',
]);

function check(status, body, what) {
  let code = '';
  let message = '';
  try { const j = JSON.parse(body); code = j?.error?.code || ''; message = j?.error?.message || ''; } catch { /* not JSON */ }
  if (status < 300 && (!code || code === 'ok')) return JSON.parse(body);
  if (SIGNALS.has(code) || status === 401 || status === 403 || status === 429) {
    raiseSignal(code || `http_${status}`, `TikTok answered ${status} ${code} during ${what}: ${message}`, 'Check the account in the TikTok app and the developer portal.');
  }
  if (code === 'privacy_level_option_mismatch' || code === 'invalid_params') raise('config_invalid', `TikTok refused ${what}: ${code} ${message}`);
  if (status >= 500) raise('upstream_error', `TikTok answered ${status} during ${what}: ${body.slice(0, 200)}`);
  raise('publish_failed', `TikTok answered ${status} ${code} during ${what}: ${message || body.slice(0, 200)}`);
}

export async function tiktokToken({ env, names, fetch: f }) {
  if (env[names.accessToken]) return env[names.accessToken];
  const [key, secret, refresh] = [env[names.clientKey], env[names.clientSecret], env[names.refreshToken]];
  if (!key || !secret || !refresh) raise('config_invalid', `TikTok needs ${names.accessToken}, or ${names.clientKey}, ${names.clientSecret} and ${names.refreshToken}`);
  const res = await f(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh }).toString(),
  });
  const body = await res.text();
  let j = {};
  try { j = JSON.parse(body); } catch { /* handled below */ }
  if (!res.ok || !j.access_token) raiseSignal('auth_revoked', `TikTok refused the refresh token: ${body.slice(0, 160)}`, 'Authorise the app again for this account.');
  return j.access_token;
}

export async function publishTikTok({ video, caption, handle, opts = {}, fetch: f = globalThis.fetch, env = process.env, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const names = {
    accessToken: 'TIKTOK_ACCESS_TOKEN', clientKey: 'TIKTOK_CLIENT_KEY', clientSecret: 'TIKTOK_CLIENT_SECRET', refreshToken: 'TIKTOK_REFRESH_TOKEN',
    ...(opts.env || {}),
  };
  const token = await tiktokToken({ env, names, fetch: f });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' };

  const infoRes = await f(`${API}/post/publish/creator_info/query/`, { method: 'POST', headers });
  const info = check(infoRes.status, await infoRes.text(), 'the creator check').data || {};
  const got = String(info.creator_username || '').replace(/^@/, '').toLowerCase();
  const want = String(handle || '').replace(/^@/, '').toLowerCase();
  if (want && got !== want) raiseSignal('identity_mismatch', `signed in as @${got}, the config expects @${want}`, 'Use the access token for the configured account.');
  const privacy = opts.privacy || 'SELF_ONLY';
  if (Array.isArray(info.privacy_level_options) && !info.privacy_level_options.includes(privacy)) {
    raise('config_invalid', `privacy ${privacy} is not offered to this account (${info.privacy_level_options.join(', ')})`);
  }

  const size = fs.statSync(video).size;
  const MAX_CHUNK = 64 * 1024 * 1024;
  const MIN_CHUNK = 5 * 1024 * 1024;
  const chunk = size <= MAX_CHUNK ? size : Math.max(MIN_CHUNK, 10 * 1024 * 1024);
  const chunks = Math.max(1, Math.floor(size / chunk));
  const initRes = await f(`${API}/post/publish/video/init/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: privacy,
        disable_duet: Boolean(opts.disableDuet),
        disable_stitch: Boolean(opts.disableStitch),
        disable_comment: Boolean(opts.disableComment),
        video_cover_timestamp_ms: opts.coverMs ?? 1000,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: chunks },
    }),
  });
  const init = check(initRes.status, await initRes.text(), 'the upload start').data;
  const bytes = fs.readFileSync(video);
  for (let i = 0; i < chunks; i++) {
    const start = i * chunk;
    const end = i === chunks - 1 ? size - 1 : start + chunk - 1;
    const up = await f(init.upload_url, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4', 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
      body: bytes.subarray(start, end + 1),
    });
    if (!up.ok && up.status !== 206) check(up.status, await up.text(), `chunk ${i + 1} of ${chunks}`);
  }
  for (let k = 0; k < (opts.pollTries || 40); k++) {
    const st = await f(`${API}/post/publish/status/fetch/`, { method: 'POST', headers, body: JSON.stringify({ publish_id: init.publish_id }) });
    const data = check(st.status, await st.text(), 'the status check').data || {};
    if (data.status === 'PUBLISH_COMPLETE') {
      const id = (data.publicaly_available_post_id || data.publicly_available_post_id || [])[0] || null;
      return { postId: id || init.publish_id, url: id ? `https://www.tiktok.com/@${got}/video/${id}` : null, account: `@${got}`, publishId: init.publish_id };
    }
    if (data.status === 'FAILED') {
      if (SIGNALS.has(data.fail_reason)) raiseSignal(data.fail_reason, `TikTok failed the post: ${data.fail_reason}`, 'Check the account in the TikTok app.');
      raise('publish_failed', `TikTok failed the post: ${data.fail_reason || 'no reason given'}`);
    }
    await sleep(opts.pollMs ?? 3000);
  }
  raise('upstream_error', `TikTok had not finished publishing ${init.publish_id} after polling`);
}
