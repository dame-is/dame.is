// Poe's idle life and its noises on stream, ported from atpota.to
// (website/src/poe/idle.ts and website/src/overlay/sounds.ts). Planning and
// sound only: mount.js owns the timers and the DOM.

/* --- idle beats ------------------------------------------------------------ */

/** Eyes shut for one blink, and open between the two of a double blink. */
export const BLINK_MS = 140;
export const BLINK_GAP_MS = 160;
export const GLANCE_MS = 1300;
/** Matches the poe-wave animation in poe.css. */
export const WAVE_MS = 1600;
export const MAX_WAVES = 3;
/** Matches the poe-startle animation. */
export const WAKE_MS = 900;
/** A happy hop; matches poe-hop. */
export const CHEER_MS = 1200;

const GAP_MIN_MS = 3500;
const GAP_SPREAD_MS = 4000;
const FIRST_WAVE_MS = 9000;
const WAVE_EVERY_MIN_MS = 40_000;
const WAVE_EVERY_SPREAD_MS = 30_000;
const GLANCE_CHANCE = 0.15;
const DOUBLE_BLINK_CHANCE = 0.15;

/** The faces a glance picks from: sparkly eyes, happy eyes, a wink. */
export const GLANCE_FACES = Object.freeze(['kawaii', 'happy', 'wink']);

export function startIdle() {
  return { elapsed: 0, waves: 0, nextWaveAt: FIRST_WAVE_MS, lastGlance: null };
}

/** How long until the next beat. Always longer than the longest beat. */
export function idleGap(random = Math.random) {
  return GAP_MIN_MS + Math.round(random() * GAP_SPREAD_MS);
}

/** What Poe does after resting for `gap` more ms. Updates `plan`. */
export function nextBeat(plan, gap, canWave, random = Math.random) {
  plan.elapsed += gap;
  if (canWave && plan.waves < MAX_WAVES && plan.elapsed >= plan.nextWaveAt) {
    plan.waves += 1;
    plan.nextWaveAt = plan.elapsed + WAVE_EVERY_MIN_MS + Math.round(random() * WAVE_EVERY_SPREAD_MS);
    return { kind: 'wave' };
  }
  const roll = random();
  if (roll < GLANCE_CHANCE) {
    const faces = GLANCE_FACES.filter((face) => face !== plan.lastGlance);
    const face = faces[Math.floor((roll / GLANCE_CHANCE) * faces.length)] ?? faces[0];
    plan.lastGlance = face;
    return { kind: 'glance', face };
  }
  return { kind: 'blink', times: roll < GLANCE_CHANCE + DOUBLE_BLINK_CHANCE ? 2 : 1 };
}

/** The breathing pace for `recordsPerSecond`: a busier atmosphere is quicker. */
export function bobMs(recordsPerSecond) {
  if (!(recordsPerSecond > 0)) return 3200;
  return Math.round(Math.max(1400, Math.min(5000, 3200 * (450 / recordsPerSecond))));
}

/* --- noises ------------------------------------------------------------------ */

/**
 * Made with WebAudio, no sound files: a soft chirp for a hello, a rising run
 * for a follow, a boop for a pet, a bell for a weather alert, a fanfare for
 * going live, a yawn as it dozes off. OBS hears them when the browser source's
 * "Control audio via OBS" is on. A browser that won't play sound before a click
 * (not OBS) just stays quiet.
 */
export const TUNES = Object.freeze({
  hello: { wave: 'sine', notes: [[660, 0, 0.12], [880, 0.1, 0.18]] },
  follow: { wave: 'triangle', notes: [[523, 0, 0.12], [659, 0.09, 0.12], [784, 0.18, 0.12], [1047, 0.27, 0.3]] },
  pet: { wave: 'sine', notes: [[440, 0, 0.08], [330, 0.07, 0.16]] },
  alert: { wave: 'sine', notes: [[988, 0, 0.5], [1319, 0.02, 0.6]] },
  live: { wave: 'triangle', notes: [[392, 0, 0.14], [523, 0.12, 0.14], [659, 0.24, 0.14], [784, 0.36, 0.45]] },
  talk: { wave: 'sine', notes: [[720, 0, 0.09]] },
  yawn: { wave: 'sine', notes: [[420, 0, 0.5], [300, 0.35, 0.6]] },
});

export const SILENT = Object.freeze({ play() {}, close() {} });

export function createSounds(volume, win = typeof window === 'undefined' ? null : window) {
  const Ctor = win?.AudioContext || win?.webkitAudioContext;
  if (!Ctor || !(volume > 0)) return SILENT;
  let ctx = null;
  const gain = Math.min(1, volume / 100) * 0.25;
  return {
    play(sound) {
      try {
        ctx ??= new Ctor();
        if (ctx.state === 'suspended') ctx.resume();
        const tune = TUNES[sound];
        if (!tune) return;
        const t0 = ctx.currentTime + 0.02;
        for (const [freq, start, length] of tune.notes) {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = tune.wave;
          osc.frequency.setValueAtTime(freq, t0 + start);
          // a quick swell and a soft tail, so nothing clicks
          env.gain.setValueAtTime(0, t0 + start);
          env.gain.linearRampToValueAtTime(gain, t0 + start + 0.015);
          env.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
          osc.connect(env).connect(ctx.destination);
          osc.start(t0 + start);
          osc.stop(t0 + start + length + 0.05);
        }
      } catch {
        // no sound is fine
      }
    },
    close() {
      try {
        ctx?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
