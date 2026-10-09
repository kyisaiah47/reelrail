#!/usr/bin/env node
// Writes the worked example's media with ffmpeg alone (see src/sample-media.js):
//
//   examples/whyyourbraindoesthat/media/bed.mp3
//   examples/whyyourbraindoesthat/media/clips/sample.mp4
import path from 'node:path';
import { makeSampleMedia } from '../src/sample-media.js';

const { bed, clip } = makeSampleMedia(path.resolve(import.meta.dirname, '..', 'examples', 'whyyourbraindoesthat', 'media'));
console.log(bed);
console.log(clip);
