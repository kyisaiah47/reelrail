// PUBLISH. Post the rendered clip to the publication's primary platform, then mark the stored row
// published with its permalink. The caption goes out exactly as the write station produced it:
// the engine appends nothing, and it runs the link firewall once more right before the upload.
//
//   outputs.primary.platform: "tiktok" | "youtube" | "none"
//   outputs.primary.transport: "api" (default) | "browser" | "dry"
//
// `--dry` always uses the dry transport.
import path from 'node:path';
import { ok, fail, guard } from '../envelope.js';
import { obj, any, str } from '../schema.js';
import { assertNoLinks } from '../gates/firewall.js';
import { publishYouTube } from '../publish/youtube.js';
import { publishTikTok } from '../publish/tiktok.js';
import { publishBrowser } from '../publish/browser.js';
import { publishDry } from '../publish/dry.js';
import { openStore } from '../store/index.js';

export default {
  name: 'publish',
  input: obj({ entryId: str(), video: str(), draft: any() }),
  async execute(input, cfg, ctx = {}) {
    const primary = cfg.outputs.primary;
    const transport = ctx.dry || primary.platform === 'none' ? 'dry' : primary.transport || 'api';
    let caption;
    try {
      caption = assertNoLinks(String(input.draft.caption || ''), cfg.links?.allow || []);
    } catch (e) {
      return fail('gate_refused', `links/caption: ${e.message}`);
    }
    const title = String(input.draft.title || input.draft.hook || '').slice(0, 100);
    const env = ctx.env || process.env;
    const res = await guard(async () => {
      if (transport === 'dry') {
        return publishDry({ video: input.video, caption, title, platform: primary.platform, handle: primary.handle, entryId: input.entryId,
          receiptsDir: path.join(cfg.stateDir, 'dry', 'receipts'), base: cfg.dir });
      }
      if (transport === 'browser') return publishBrowser({ video: input.video, caption, opts: { ...(primary.browser || {}), handle: primary.handle }, open: ctx.openBrowser });
      if (primary.platform === 'youtube') {
        return publishYouTube({ video: input.video, title, description: caption, tags: (caption.match(/#[\w]+/g) || []).map((t) => t.slice(1)),
          handle: primary.handle, opts: { ...(primary.youtube || {}), vertical: cfg.frame.h > cfg.frame.w }, fetch: ctx.fetch, env });
      }
      if (primary.platform === 'tiktok') {
        return publishTikTok({ video: input.video, caption, handle: primary.handle, opts: primary.tiktok || {}, fetch: ctx.fetch, env, sleep: ctx.sleep });
      }
      throw new Error(`no transport for platform ${primary.platform}`);
    }, 'publish_failed');
    if (!res.ok) return res;
    const posted = res.data;
    if (!(ctx.stationOnly && ctx.dry)) {
      try {
        const store = await openStore(cfg, { dry: ctx.dry, fetch: ctx.fetch, env });
        await store.patch(cfg.publication, input.entryId, {
          published: true,
          permalink: posted.url,
          platform: transport === 'dry' ? `${primary.platform}:dry` : primary.platform,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        return fail('store_failed', `posted (${posted.url || posted.postId}) but the stored row could not be marked published: ${e.message}`, { posted });
      }
    }
    return ok({ ...posted, transport, platform: primary.platform, entryId: input.entryId });
  },
};
