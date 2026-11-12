// The page's end of the darkroom: ask for a picture of the sky, get better
// and better ones back.

import { createDarkroom } from './darkroom.js';

/**
 * `onImage({ id, image, rays, done })` is called with each picture. Returns
 * `{ start(spec), setGain(gain), stop(), dispose() }`.
 */
export function createExposure(onImage) {
  let worker = null;
  try {
    worker = new Worker(new URL('./tracer.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }) => onImage(data);
    // A worker that fails to load says so here, after the fact. Fall back to
    // tracing on the page, in thinner slices.
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (pending) local().start(pending);
    };
  } catch {
    worker = null;
  }
  let room = null;
  let pending = null;
  const local = () => (room ||= createDarkroom(onImage, { slice: 10 }));

  return {
    start(spec) {
      pending = spec;
      if (worker) worker.postMessage({ type: 'start', spec });
      else local().start(spec);
    },
    setGain(gain) {
      if (pending) pending = { ...pending, gain };
      if (worker) worker.postMessage({ type: 'gain', gain });
      else local().setGain(gain);
    },
    stop() {
      pending = null;
      if (worker) worker.postMessage({ type: 'stop' });
      else room?.stop();
    },
    dispose() {
      worker?.terminate();
      worker = null;
      room?.stop();
    },
  };
}
