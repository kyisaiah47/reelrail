// `reelrail init [dir]`: copies the worked example into a folder you own and makes its sample
// media there, so a dry slot runs straight after `npm install -g reelrail`.
import fs from 'node:fs';
import path from 'node:path';
import { makeSampleMedia } from './sample-media.js';

const EXAMPLE = path.join(import.meta.dirname, '..', 'examples', 'whyyourbraindoesthat');
const FILES = ['publication.json', 'subjects.json', 'facts.json', 'voice.md'];

export function initExample(target, { media = true } = {}) {
  const dir = path.resolve(target);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists and is not empty. Pick a new folder name.`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(EXAMPLE, f), path.join(dir, f));
  const made = media ? makeSampleMedia(path.join(dir, 'media')) : null;
  return { dir, files: FILES.map((f) => path.join(dir, f)), media: made };
}
