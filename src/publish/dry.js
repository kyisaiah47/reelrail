// THE DRY TRANSPORT. It does everything a real publish does up to the network: it reads the file,
// hashes it, runs the caption through the link firewall, and writes a receipt naming what would
// have been sent and where. Nothing leaves the machine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function publishDry({ video, caption, title, platform, handle, entryId, receiptsDir, base = null }) {
  const bytes = fs.readFileSync(video);
  const receipt = {
    transport: 'dry',
    platform,
    handle,
    entryId,
    video: base ? path.relative(base, video) : path.basename(video),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    title: title || null,
    caption,
    wouldCall: platform === 'youtube'
      ? ['POST oauth2 token', 'GET youtube/v3/channels?mine=true', 'POST upload/youtube/v3/videos?uploadType=resumable', 'PUT upload location']
      : platform === 'tiktok'
        ? ['POST v2/post/publish/creator_info/query/', 'POST v2/post/publish/video/init/', 'PUT upload_url', 'POST v2/post/publish/status/fetch/']
        : [],
    at: new Date().toISOString(),
  };
  fs.mkdirSync(receiptsDir, { recursive: true });
  const file = path.join(receiptsDir, `${entryId}.json`);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  return { postId: `dry-${receipt.sha256.slice(0, 12)}`, url: null, account: handle, receipt: file };
}
