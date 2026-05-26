// Shared "live data" refresh tick. All long-lived consumers
// (NowPlaying, NowStatus, the home feed) subscribe to the same
// interval so their refreshes hit the network together instead of
// drifting on their own schedules — easier on the user's bandwidth
// and easier to reason about ("everything updates every 30s").
//
// Listeners are skipped while the tab is hidden, and fire
// immediately when the tab comes back into focus.

const TICK_MS = 30_000;

const SUBSCRIBERS = new Set();
let intervalId = null;
let visibilityWired = false;

function fireAll() {
  if (typeof document !== 'undefined' && document.hidden) return;
  for (const fn of SUBSCRIBERS) {
    try {
      fn();
    } catch {
      // a single listener throwing shouldn't break the rest
    }
  }
}

function onVisibility() {
  if (typeof document !== 'undefined' && !document.hidden) fireAll();
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
