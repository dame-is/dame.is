import { useSyncExternalStore } from 'react';
import { subscribeRefreshTick } from '../lib/refreshTick.js';

// A shared, coarse clock for anything that prints relative time ("2m ago",
// "Today"). Those strings are computed at render, and a quiet feed doesn't
// re-render — the refresh tick skips the rebuild when the repo hasn't moved —
// so without this a tab left open kept saying "2m ago" for hours, and still
// said "Today" after midnight.
//
// It rides the shared 30s refresh tick rather than a timer of its own, so it
// pauses with the tab hidden and catches up the moment the tab comes back.
// The value only moves once a minute has passed (nothing printed is finer than
// that), which keeps getSnapshot stable between calls and means the leaf
// components re-render about once a minute — the feed around them doesn't.

const STEP_MS = 60_000;

let now = Date.now();
const listeners = new Set();
let unsubscribeTick = null;

// Advance `now` if a minute has gone by. Lazily, so the first component to
// mount after a long idle stretch reads a fresh value, not a stale one.
function advance() {
  const t = Date.now();
  if (t - now < STEP_MS) return false;
  now = t;
  return true;
}

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot() {
  // A read that moves the clock tells everyone already showing the old
  // value, or they'd lag a step behind the newcomer until the next tick
  // (which would find nothing left to advance). After the render, since
  // waking a subscriber mid-render is an update React refuses.
  if (advance()) queueMicrotask(notify);
  return now;
}

function onTick() {
  if (advance()) notify();
}

function subscribe(listener) {
  listeners.add(listener);
  if (!unsubscribeTick) unsubscribeTick = subscribeRefreshTick(onTick);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeTick) {
      unsubscribeTick();
      unsubscribeTick = null;
    }
  };
}

/** The current time as a Date, refreshed about once a minute. */
export function useNow() {
  const t = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return new Date(t);
}
