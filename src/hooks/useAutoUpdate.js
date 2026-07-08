// Auto-refresh on deploy.
//
// dame.is rebuilds often — on every push and on a 6-hour PDS-refresh cron —
// so a tab left open drifts onto stale code. This watcher closes that gap:
// the running app polls a tiny `/version.json` (emitted at build time with
// the same build id baked into this bundle) and, when the deployed id no
// longer matches ours, reloads to pick up the new build.
//
// It's the lightweight, service-worker-free cousin of Anisota's PWA
// auto-update: no Workbox, no cached shell to invalidate — just a build-id
// comparison and a guarded `location.reload()`.
//
// Guards:
//   - Production only. Dev hot-reloads itself and ships no version.json.
//   - Never interrupts work in progress — defers while the owner is in edit
//     mode, has a quick-edit sheet open, or is focused in a text field —
//     then applies the update on the next safe moment (a navigation, edit
//     mode closing, or the next poll).
//   - Reloads at most once per distinct deployed id, so a misconfigured
//     build (baked id vs. version.json disagreeing) can never loop.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useEditMode } from './useEditMode.jsx';
import { BUILD_ID } from '../lib/appVersion.js';

// How often to ask the server whether a newer build has shipped. Cheap:
// version.json is a few bytes, usually answered with a 304, and only polled
// while the tab is visible. We also check on focus / reconnect, so an idle
// tab catches up the instant the reader returns.
const CHECK_INTERVAL_MS = 60_000;

// Let first paint settle before the first look.
const KICKOFF_DELAY_MS = 3_000;

// Remembers which build we last reloaded *to*. If a deploy's baked id and
// its version.json ever disagree we'd otherwise reload forever; keying on
// the target id means we reload at most once per distinct id.
const RELOAD_TARGET_KEY = 'dame.update.reloadedTo';

function readReloadTarget() {
  try {
    return sessionStorage.getItem(RELOAD_TARGET_KEY);
  } catch {
    return null;
  }
}

function writeReloadTarget(id) {
  try {
    sessionStorage.setItem(RELOAD_TARGET_KEY, id);
  } catch {
    /* sessionStorage may be unavailable (private mode, etc.) */
  }
}

async function fetchDeployedBuildId() {
  // Cache-bust hard — query param + no-store — so neither the browser nor
  // Vercel's edge can hand us a stale version.json.
  const res = await fetch(`/version.json?_=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data && typeof data.id === 'string' ? data.id : null;
}

// Reload to apply `served` if it's safe and we haven't already tried it.
// Returns true if a reload was triggered.
function attemptReload(served, isSafe) {
  if (!served) return false;
  if (!isSafe()) return false; // defer: user is mid-edit
  if (readReloadTarget() === served) return false; // loop guard
  writeReloadTarget(served);
  window.location.reload();
  return true;
}

export default function useAutoUpdate() {
  const location = useLocation();
  const editMode = useEditMode();

  // The deployed build id we've detected as newer than ours and are waiting
  // to apply. Null when we're up to date.
  const pendingRef = useRef(null);

  // Latest "safe to reload?" test, kept in a ref so the polling loop reads
  // current edit state without re-arming its interval on every keystroke.
  const isSafeRef = useRef(() => true);
  isSafeRef.current = () => {
    if (editMode.active) return false; // owner is bulk-editing the feed
    if (editMode.editSheet) return false; // a quick-edit sheet is open
    const el = typeof document !== 'undefined' ? document.activeElement : null;
    if (el) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
      if (el.isContentEditable) return false;
    }
    return true;
  };

  // The poll loop + listeners. Armed once; reads live state through refs.
  useEffect(() => {
    if (!import.meta.env.PROD) return; // dev hot-reloads itself
    if (typeof window === 'undefined') return;

    let cancelled = false;

    // If we reloaded to reach this build and we're now running it, clear the
    // loop-guard marker so a *future* deploy can reload again.
    if (readReloadTarget() === BUILD_ID) {
      try {
        sessionStorage.removeItem(RELOAD_TARGET_KEY);
      } catch {
        /* ignore */
      }
    }

    const check = async () => {
      if (cancelled || document.hidden) return;
      let served;
      try {
        served = await fetchDeployedBuildId();
      } catch {
        return; // offline / transient — try again next tick
      }
      if (cancelled || !served) return;
      if (served === BUILD_ID) {
        pendingRef.current = null; // up to date (e.g. a rollback)
        return;
      }
      pendingRef.current = served;
      attemptReload(served, isSafeRef.current);
    };

    const onWake = () => {
      if (!document.hidden) check();
    };

    const intervalId = setInterval(check, CHECK_INTERVAL_MS);
    const kickoffId = setTimeout(check, KICKOFF_DELAY_MS);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('online', check);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearTimeout(kickoffId);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('online', check);
    };
  }, []);

  // Retry a deferred reload the moment it becomes safe: the reader navigates
  // (edit mode + selection clear on route change) or closes edit mode / the
  // quick-edit sheet. A short delay lets focus settle after the state change.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!pendingRef.current) return;
    const t = setTimeout(() => {
      attemptReload(pendingRef.current, isSafeRef.current);
    }, 400);
    return () => clearTimeout(t);
  }, [location.pathname, editMode.active, editMode.editSheet]);
}
