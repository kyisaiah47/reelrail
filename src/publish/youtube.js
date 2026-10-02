// YouTube, through the official YouTube Data API v3 resumable upload.
//
// Auth: an OAuth client of your own with the youtube.upload and youtube.readonly scopes. Put
// YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in the environment (or
// YOUTUBE_ACCESS_TOKEN for a short-lived token). The env names can be changed in
// outputs.primary.env.
//
// Before any upload the authenticated channel's handle is read back and compared with
// outputs.primary.handle. A mismatch is a platform signal and nothing is uploaded.
import fs from 'node:fs';
import { raise, raiseSignal } from '../envelope.js';

const SIGNAL_REASONS = new Set(['quotaExceeded', 'uploadLimitExceeded', 'dailyLimitExceeded', 'rateLimitExceeded',
  'userRateLimitExceeded', 'forbidden', 'youtubeSignupRequired', 'accountClosed', 'accountSuspended', 'authError', 'insufficientPermissions']);

function classify(status, body, what) {
  let reason = '';
  try { reason = JSON.parse(body)?.error?.errors?.[0]?.reason || JSON.parse(body)?.error?.status || ''; } catch { /* body is not JSON */ }
  if (status === 401) raiseSignal('auth', `YouTube refused the token during ${what} (401)`, 'Create a new refresh token for this channel.');
  if (status === 403 || status === 429 || SIGNAL_REASONS.has(reason)) raiseSignal(reason || `http_${status}`, `YouTube answered ${status} ${reason} during ${what}`, 'Check the channel and the API quota in Google Cloud.');
  if (status >= 500) raise('upstream_error', `YouTube answered ${status} during ${what}: ${body.slice(0, 200)}`);
  raise('publish_failed', `YouTube answered ${status} ${reason} during ${what}: ${body.slice(0, 200)}`);
}

export async function accessToken({ env, names, fetch: f }) {
  if (env[names.accessToken]) return env[names.accessToken];
  const [id, secret, refresh] = [env[names.clientId], env[names.clientSecret], env[names.refreshToken]];
  if (!id || !secret || !refresh) raise('config_invalid', `YouTube needs ${names.refreshToken}, ${names.clientId} and ${names.clientSecret} in the environment`);
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
  });
  const body = await res.text();
  if (!res.ok) {
    if (/invalid_grant|unauthorized_client|invalid_client/.test(body)) raiseSignal('auth_revoked', `Google refused the refresh token: ${body.slice(0, 160)}`, 'Sign in again and store a new refresh token.');
    classify(res.status, body, 'the token refresh');
  }
  return JSON.parse(body).access_token;
}

export async function publishYouTube({ video, title, description, tags = [], handle, opts = {}, fetch: f = globalThis.fetch, env = process.env }) {
  const names = {
    accessToken: 'YOUTUBE_ACCESS_TOKEN', clientId: 'YOUTUBE_CLIENT_ID', clientSecret: 'YOUTUBE_CLIENT_SECRET', refreshToken: 'YOUTUBE_REFRESH_TOKEN',
    ...(opts.env || {}),
  };
  const token = await accessToken({ env, names, fetch: f });
  const auth = { authorization: `Bearer ${token}` };

  const me = await f('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: auth });
  const meBody = await me.text();
  if (!me.ok) classify(me.status, meBody, 'the channel check');
  const ch = JSON.parse(meBody)?.items?.[0];
  if (!ch) raiseSignal('no_channel', 'the token has no YouTube channel', 'Sign in with the account that owns the channel.');
  const got = String(ch.snippet?.customUrl || '').replace(/^@/, '').toLowerCase();
  const want = String(handle || '').replace(/^@/, '').toLowerCase();
  if (want && got !== want) raiseSignal('identity_mismatch', `signed in as @${got}, the config expects @${want}`, 'Use the refresh token for the configured channel.');

  const bytes = fs.statSync(video).size;
  const init = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(bytes), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify({
      snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags, categoryId: opts.categoryId || '22' },
      status: { privacyStatus: opts.privacy || 'private', selfDeclaredMadeForKids: false, ...(opts.status || {}) },
    }),
  });
  if (!init.ok) classify(init.status, await init.text(), 'the upload start');
  const location = init.headers.get('location');
  if (!location) raise('upstream_error', 'YouTube returned no upload location');
  const put = await f(location, { method: 'PUT', headers: { ...auth, 'content-type': 'video/mp4', 'content-length': String(bytes) }, body: fs.readFileSync(video) });
  const putBody = await put.text();
  if (!put.ok) classify(put.status, putBody, 'the upload');
  const id = JSON.parse(putBody).id;
  const vertical = opts.vertical !== false;
  return { postId: id, url: vertical ? `https://www.youtube.com/shorts/${id}` : `https://youtu.be/${id}`, account: `@${got}` };
}
