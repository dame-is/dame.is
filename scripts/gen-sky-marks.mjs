#!/usr/bin/env node
// Generates the small sky-avatar frames the top chrome's brand mark paints,
// and writes them beside the originals as images/sky-avatars/mark/<key>.webp.
// Run manually whenever the sky-avatar art changes, and commit the output:
//
//   node scripts/gen-sky-marks.mjs
//
// The mark is drawn at 1.3em of the site name, about 23px, but it used to load
// the full 893px frame: roughly 360 KB on every first visit, and another frame
// for each hour stepped through in the sky-hour sheet. 96px covers that box at
// 3x DPR for a few KB. The originals stay where they are, because the admin
// shows them large and PublicationsManager uploads one as a publication icon.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { avatarKeys } from '../og/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKY = resolve(__dirname, '../images/sky-avatars');
const OUT = resolve(SKY, 'mark');

const SIZE = 96;
const QUALITY = 82;

await mkdir(OUT, { recursive: true });
let total = 0;
for (const key of avatarKeys()) {
  const raw = await readFile(resolve(SKY, `${key}.jpg`));
  const out = await sharp(raw)
    .resize(SIZE, SIZE, { fit: 'cover' })
    .webp({ quality: QUALITY })
    .toBuffer();
  await writeFile(resolve(OUT, `${key}.webp`), out);
  total += out.length;
}
console.log(
  `wrote ${avatarKeys().length} marks to ${OUT} (${(total / 1024).toFixed(1)} KB)`,
);
