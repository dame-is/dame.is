// The darkroom: where a picture of the sky is exposed, a slice at a time.
//
// Tracing a few million rays takes seconds, so it is done in short slices
// with the picture handed back between them, and it sharpens as you watch.
// The same code runs in a worker (tracer.worker.js) and, where there are no
// workers, on the page itself between frames.

import {
  clearSkyMap,
  coarseness,
  createSkyMap,
  createTracer,
  develop,
  expose,
} from './halo.js';

const now = () => performance.now();

/**
 * `post(message)` is given `{ id, image, size, rays, done }` each time there is a
 * better picture. `slice` is how long to trace before coming up for air, in
 * milliseconds.
 */
export function createDarkroom(post, { slice = 30 } = {}) {
  const random = Math.random;
  const tracer = createTracer({ random });
  let map = null;
  let job = null;

  function show(mine, done) {
    mine.shown = now();
    mine.shows += 1;
    const { image, size } = develop(map, mine.gain, coarseness(map));
    post({ id: mine.id, image, size, rays: map.rays, done });
  }

  function step(mine) {
    if (job !== mine) return;
    const began = now();
    while (now() - began < slice && map.rays < mine.budget) {
      expose(tracer, map, mine.crystals, mine.sunAltitude, 6000, random);
    }
    const done = map.rays >= mine.budget;
    // Often at first, while the picture is changing fast, then less so.
    const wait = Math.min(900, 80 + mine.shows * 70);
    if (done || now() - mine.shown > wait) show(mine, done);
    if (done) mine.done = true;
    else setTimeout(() => step(mine), 0);
  }

  return {
    /** `{ id, size, sunAltitude, crystals, gain, budget }` */
    start(spec) {
      job = { ...spec, shown: now(), shows: 0, done: false };
      if (!map || map.size !== spec.size) map = createSkyMap(spec.size);
      else clearSkyMap(map);
      if (spec.crystals.length) step(job);
      else show(job, true);
    },
    /** A new exposure for the picture there is, without tracing it again. */
    setGain(gain) {
      if (!job) return;
      job.gain = gain;
      if (map) show(job, job.done);
    },
    stop() {
      job = null;
    },
  };
}
