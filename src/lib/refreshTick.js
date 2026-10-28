// Shared "live data" refresh tick. All long-lived consumers
// (NowPlaying, NowStatus, the home feed) subscribe to the same
// interval so their refreshes hit the network together instead of
// drifting on their own schedules — easier on the user's bandwidth
// and easier to reason about ("everything updates every 30s").
//
// Listeners are skipped while the tab is hidden, and fire
// immediately when the tab comes back into focus.

const TICK_MS = 30_000;

// A tab coming back within this long of the last fire has nothing new to
// fetch: flicking away and back shouldn't cost a round of requests each time.
const VISIBILITY_MIN_GAP_MS = 5_000;

const SUBSCRIBERS = new Set();
let intervalId = null;
let visibilityWired = false;
let lastFireAt = 0;

function fireAll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  lastFireAt = Date.now();
  for (const fn of SUBSCRIBERS) {
    try {
      fn();
    } catch {
      // a single listener throwing shouldn't break the rest
    }
  }
}

function onVisibility() {
  if (typeof document === 'undefined' || document.hidden) return;
  if (Date.now() - lastFireAt < VISIBILITY_MIN_GAP_MS) return;
  fireAll();
  // Start the next 30s from here. The interval kept its old phase across the
  // hidden stretch, so a return a second before it was due fired everything
  // twice in a second.
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = setInterval(fireAll, TICK_MS);
  }
}

function start() {
  if (intervalId) return;
  intervalId = setInterval(fireAll, TICK_MS);
  if (typeof document !== 'undefined' && !visibilityWired) {
    document.addEventListener('visibilitychange', onVisibility);
    visibilityWired = true;
  }
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (typeof document !== 'undefined' && visibilityWired) {
    document.removeEventListener('visibilitychange', onVisibility);
    visibilityWired = false;
  }
}

export function subscribeRefreshTick(fn) {
  SUBSCRIBERS.add(fn);
  start();
  return () => {
    SUBSCRIBERS.delete(fn);
    if (SUBSCRIBERS.size === 0) stop();
  };
}

export const REFRESH_TICK_MS = TICK_MS;
