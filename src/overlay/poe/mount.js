// Poe on dame.is's stream: atpota.to's on-stream potato (website/src/overlay/
// poe.ts there), in a box on the grid instead of a fixed corner. It idles
// (blinks, glances, a wave now and then), bobs faster when the atmosphere is
// busy (setPace), and naps when the stream has been quiet for `napMs`; the
// next thing that happens startles it awake. Lines come up one at a time in
// a bubble over its head, each for its `ms`, with a face, the person's avatar
// when there is one, a noise, and sometimes a hop or a burst. The queue keeps
// the most important lines when they pile up and drops any that waited longer
// than STALE_MS: by then they aren't news.
//
// The bubble is dame.is's: a page plate with the site's hairline and square
// corners, the label in the ledger's small caps, the words in Crimson. Poe
// itself is atpota.to's, drawings and all.
//
// Every word reaches the page through textContent. Unlike atpota.to's (which
// lives for the life of its page), this one is mounted by a React widget, so
// it keeps every timer it starts and destroy() clears them all.

import { BLINK_GAP_MS, BLINK_MS, CHEER_MS, GLANCE_MS, MAX_WAVES, WAKE_MS, WAVE_MS, bobMs, idleGap, nextBeat, startIdle, SILENT } from './life.js';
import { RIGHT_FACES } from './faces.js';

export const LINE_MS = 7000;
/** A beat of quiet between lines. */
export const LINE_GAP_MS = 1200;
export const MAX_QUEUED = 4;
export const STALE_MS = 45_000;

/** Adds `line` to `queue`, keeping the MAX_QUEUED most important (ties: the newest) in the order they came. */
export function enqueue(queue, line, at, n) {
  const rank = (q) => q.line.rank ?? 0;
  return [...queue, { line, at, n }]
    .sort((x, y) => rank(y) - rank(x) || y.n - x.n)
    .slice(0, MAX_QUEUED)
    .sort((x, y) => x.n - y.n);
}

const BURST_COUNT = { leaves: 14, hearts: 10, petals: 16 };

function el(doc, tag, cls) {
  const node = doc.createElement(tag);
  node.className = cls;
  return node;
}

export function mountPoe(host, { faces: initialFaces = RIGHT_FACES, sounds: initialSounds = SILENT, napMs: initialNap = 5 * 60_000, now = () => Date.now() } = {}) {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  let faces = initialFaces;
  let sounds = initialSounds;
  let napMs = initialNap;
  let destroyed = false;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = win.setTimeout(() => {
      timers.delete(id);
      if (!destroyed) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const cancel = (id) => {
    if (id === undefined) return;
    win.clearTimeout(id);
    timers.delete(id);
  };

  const bubble = el(doc, 'div', 'ov-bubble');
  bubble.hidden = true;
  bubble.setAttribute('role', 'status');
  const avatar = el(doc, 'img', 'ov-bubble-avatar');
  avatar.alt = '';
  avatar.hidden = true;
  avatar.referrerPolicy = 'no-referrer';
  const words = el(doc, 'div', 'ov-bubble-words');
  const label = el(doc, 'p', 'ov-bubble-label');
  const text = el(doc, 'p', 'ov-bubble-text');
  const sub = el(doc, 'p', 'ov-bubble-sub');
  words.append(label, text, sub);
  bubble.append(avatar, words);

  const potato = el(doc, 'div', 'ov-potato');
  const arm = el(doc, 'img', 'ov-potato-arm');
  arm.src = faces.arm;
  arm.alt = '';
  const img = el(doc, 'img', 'ov-potato-img');
  img.src = faces.face.normal;
  img.alt = 'poe, the atpotato potato';
  const zzz = el(doc, 'span', 'ov-potato-zzz');
  zzz.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) zzz.append(Object.assign(doc.createElement('i'), { textContent: 'z' }));
  potato.append(arm, img, zzz);
  const bits = el(doc, 'div', 'ov-bursts');
  bits.setAttribute('aria-hidden', 'true');
  host.append(bubble, potato, bits);

  /* faces */
  let talkFace = null;
  let reactFace = null;
  let reactTimer;
  let beatSrc = null;
  let napping = false;
  const show = () => {
    const src = beatSrc ?? faces.face[talkFace ?? reactFace ?? (napping ? 'sleepy' : 'normal')];
    if (img.getAttribute('src') !== src) img.src = src;
  };

  /* idle life */
  const plan = startIdle();
  let frameTimer;
  let busy = false;
  let lastStir = now();
  const endBeat = () => {
    cancel(frameTimer);
    busy = false;
    beatSrc = null;
    delete potato.dataset.waving;
    delete potato.dataset.hopping;
    delete potato.dataset.startled;
    show();
  };
  const play = (frames, attr) => {
    endBeat();
    busy = true;
    if (attr) potato.dataset[attr] = 'true';
    const step = (i) => {
      const frame = frames[i];
      if (!frame) {
        endBeat();
        return;
      }
      beatSrc = frame[0];
      show();
      frameTimer = later(() => step(i + 1), frame[1]);
    };
    step(0);
  };
  const wave = () => play([[faces.wave, WAVE_MS]], 'waving');
  const hop = (face) => play([[faces.face[face], CHEER_MS]], 'hopping');
  const playBeat = (beat) => {
    const shut = faces.face.sleepy;
    if (beat.kind === 'wave') return wave();
    if (beat.kind === 'glance') return play([[faces.face[beat.face], GLANCE_MS]]);
    return play(beat.times === 2 ? [[shut, BLINK_MS], [null, BLINK_GAP_MS], [shut, BLINK_MS]] : [[shut, BLINK_MS]]);
  };
  const nap = () => {
    endBeat();
    napping = true;
    potato.dataset.napping = 'true';
    sounds.play('yawn');
    show();
  };
  /** Wakes with a start; true when Poe was asleep (so a line waits for the jump). */
  const wake = () => {
    lastStir = now();
    if (!napping) return false;
    napping = false;
    delete potato.dataset.napping;
    play([[faces.face.wow, WAKE_MS]], 'startled');
    return true;
  };
  const idle = () => {
    const gap = idleGap();
    later(() => {
      idle();
      if (busy || talkFace || reactFace || napping) return;
      if (napMs > 0 && now() - lastStir >= napMs) {
        nap();
        return;
      }
      // On stream there's no "once they've found it": keep waving now and then.
      if (plan.waves >= MAX_WAVES) plan.waves = 0;
      playBeat(nextBeat(plan, gap, true));
    }, gap);
  };
  idle();

  /* celebrations, inside the box so they scale with the canvas */
  const burst = (kind) => {
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const n = BURST_COUNT[kind] || 12;
    for (let i = 0; i < n; i += 1) {
      const bit = el(doc, 'span', `ov-burst ov-burst-${kind}`);
      const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.6;
      const distance = 80 + Math.random() * 90;
      bit.style.setProperty('--dx', `${Math.round(Math.cos(angle) * distance)}px`);
      bit.style.setProperty('--dy', `${Math.round(Math.sin(angle) * distance - 40)}px`);
      bit.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`);
      bit.dataset.shade = String(i % 3);
      bits.append(bit);
      later(() => bit.remove(), 900);
    }
  };

  /* lines */
  let queue = [];
  let pushed = 0;
  let talking = false;
  const next = () => {
    if (talking) return;
    const t = now();
    queue = queue.filter((q) => t - q.at < STALE_MS);
    const first = queue.shift();
    if (!first) return;
    const { line } = first;
    talking = true;
    label.textContent = line.label ?? '';
    label.hidden = !line.label;
    text.textContent = line.text;
    sub.textContent = line.sub ?? '';
    sub.hidden = !line.sub;
    if (line.avatar) avatar.src = line.avatar;
    else avatar.removeAttribute('src');
    avatar.hidden = !line.avatar;
    bubble.hidden = false;
    bubble.classList.remove('is-leaving');
    talkFace = line.face ?? 'wink';
    if (line.hop) hop(talkFace);
    else if (line.wave) wave();
    else endBeat();
    sounds.play(line.sound ?? 'talk');
    if (line.burst) burst(line.burst);
    later(() => {
      bubble.classList.add('is-leaving');
      talkFace = null;
      lastStir = now();
      show();
      later(() => {
        bubble.hidden = true;
        talking = false;
        next();
      }, LINE_GAP_MS);
    }, line.ms ?? LINE_MS);
  };

  return {
    say(line) {
      queue = enqueue(queue, line, now(), pushed++);
      if (wake()) later(next, WAKE_MS);
      else next();
    },
    stir() {
      wake();
    },
    setPace(rate) {
      potato.style.setProperty('--bob', `${bobMs(rate)}ms`);
    },
    setFaces(nextFaces) {
      faces = nextFaces;
      arm.src = faces.arm;
      show();
    },
    setNap(ms) {
      napMs = ms;
    },
    setSounds(nextSounds) {
      sounds = nextSounds;
    },
    react(face, ms) {
      wake();
      cancel(reactTimer);
      reactFace = face;
      show();
      reactTimer = later(() => {
        reactFace = null;
        show();
      }, ms);
    },
    destroy() {
      destroyed = true;
      for (const id of timers) win.clearTimeout(id);
      timers.clear();
      bubble.remove();
      potato.remove();
      bits.remove();
    },
  };
}
