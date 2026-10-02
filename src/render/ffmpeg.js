// Thin wrappers over ffmpeg, ffprobe and python3. Every call is execFile with an argument array;
// nothing goes through a shell.
import { execFile } from 'node:child_process';

export const bins = {
  ffmpeg: process.env.REELRAIL_FFMPEG || 'ffmpeg',
  ffprobe: process.env.REELRAIL_FFPROBE || 'ffprobe',
  python: process.env.REELRAIL_PYTHON || 'python3',
};

export function run(bin, args, { input = null, timeoutMs = 600000, maxBuffer = 1 << 26, encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, maxBuffer, encoding }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`${bin} ${args.slice(0, 3).join(' ')} ... failed: ${String(stderr || err.message).trim().split('\n').slice(-4).join(' | ')}`);
        e.stderr = stderr;
        reject(e);
      } else resolve({ stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
  });
}

export async function probe(file) {
  const { stdout } = await run(bins.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(stdout);
}

export async function duration(file) {
  const { stdout } = await run(bins.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(stdout);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`could not read a duration from ${file}`);
  return d;
}

export async function hasBinary(bin, args = ['-version']) {
  try { await run(bin, args, { timeoutMs: 20000 }); return true; } catch { return false; }
}
