// Poe's faces: atpota.to's mascot drawings (src/assets/poe, copied from
// atpota.to's website/src/assets/mascot), and the same faces mirrored for a
// Poe that sits on the left of its box and faces into the screen.
//
// The mirror is atpota.to's (website/src/overlay/mirror.ts): every part of a
// face is flipped except the @ on Poe's tummy, which would read backwards. The
// drawings are 515 wide; the @ is the run of skin-coloured (#a58650) paths
// after the face (the first #725b36 one), centred at x 259.1 in every face, so
// mirroring the rest and shifting the @ by 515 - 2 × 259.1 keeps it in place
// the right way round. The arm, which has no face, is mirrored whole.

import arm from '../../assets/poe/potato-arm.svg?url';
import dead from '../../assets/poe/potato-dead.svg?url';
import happy from '../../assets/poe/potato-happy.svg?url';
import kawaii from '../../assets/poe/potato-kawaii.svg?url';
import normal from '../../assets/poe/potato-normal.svg?url';
import scawy from '../../assets/poe/potato-scawy.svg?url';
import sleepy from '../../assets/poe/potato-sleepy.svg?url';
import wave from '../../assets/poe/potato-wave.svg?url';
import wink from '../../assets/poe/potato-wink.svg?url';
import wow from '../../assets/poe/potato-wow.svg?url';

export const FACE_URLS = Object.freeze({ normal, kawaii, happy, wink, wow, sleepy, scawy, dead });
export const RIGHT_FACES = Object.freeze({ face: FACE_URLS, wave, arm });

const VIEW_WIDTH = 515;
const AT_CENTER_X = 259.1;
const FACE = '#725b36';
const AT = '#a58650';

const colour = (el, attr) => (el.getAttribute(attr) || '').toLowerCase();

/** The SVG mirrored left to right, with its tummy @ still reading the right way. */
export function mirrorSvg(text, parser = new DOMParser()) {
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') return text;
  const parts = [...svg.children];
  const face = parts.findIndex((el) => colour(el, 'fill') === FACE || colour(el, 'stroke') === FACE);
  const isAt = (el, i) => face >= 0 && i > face && colour(el, 'fill') === AT;
  const ns = 'http://www.w3.org/2000/svg';
  const mirrored = doc.createElementNS(ns, 'g');
  mirrored.setAttribute('transform', `matrix(-1 0 0 1 ${VIEW_WIDTH} 0)`);
  const at = doc.createElementNS(ns, 'g');
  at.setAttribute('transform', `translate(${(VIEW_WIDTH - 2 * AT_CENTER_X).toFixed(1)} 0)`);
  parts.forEach((el, i) => (isAt(el, i) ? at : mirrored).append(el));
  svg.append(mirrored);
  if (at.childElementCount) svg.append(at);
  return new XMLSerializer().serializeToString(svg);
}

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

let left = null;

/** Every face facing right, made once a page; the usual faces if that fails. */
export function leftFaces() {
  if (!left) {
    left = (async () => {
      const flip = async (url) => dataUrl(mirrorSvg(await (await fetch(url)).text()));
      const entries = await Promise.all(Object.entries(FACE_URLS).map(async ([name, url]) => [name, await flip(url)]));
      return { face: Object.fromEntries(entries), wave: await flip(wave), arm: await flip(arm) };
    })().catch(() => {
      left = null;
      return RIGHT_FACES;
    });
  }
  return left;
}

let preloaded = false;

/** Fetch and decode every face once, so a change of face never flickers. */
export function preloadFaces() {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const url of [...Object.values(FACE_URLS), wave, arm]) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode?.().catch(() => undefined);
  }
}
