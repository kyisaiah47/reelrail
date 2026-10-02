import fs from 'node:fs';
import path from 'node:path';

export const VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version;
