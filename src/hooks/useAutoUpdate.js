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
//     mode, has a quick-edit sheet open, a sheet / modal / the dock is open,
//     a text field has focus or unsent text, media is playing or an embed
//     has focus, or a long-running job holds the tab (lib/reloadHold.js —
//     e.g. the analytics archive build's multi-minute sweep) — then applies
//     the update on the next safe moment (a navigation, one of those
//     closing, or the next poll).
//   - Reloads at most once per distinct deployed id, so a misconfigured
//     build (baked id vs. version.json disagreeing) can never loop — and not
//     at all when storage is blocked, since that guard couldn't survive the
//     reload it exists to limit.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useEditMode } from './useEditMode.jsx';
import { useChromePanel } from './useChromePanel.jsx';
import { useActionDock } from './useActionDock.jsx';
import { BUILD_ID } from '../lib/appVersion.js';
import { isReloadHeld } from '../lib/reloadHold.js';
import { isStorageVolatile } from '../lib/storageGuard.js';
import {
  RELOAD_TARGET_KEY,
  attemptReload,
  documentIsBusy,
  readReloadTarget,
} from '../lib/autoUpdate.js';

// How often to ask the server whether a newer build has shipped. Cheap:
// version.json is a few bytes, usually answered with a 304, and only polled
// while the tab is visible. We also check on focus / reconnect, so an idle
// tab catches up the instant the reader returns.
const CHECK_INTERVAL_MS = 60_000;

// Let first paint settle before the first look.
const KICKOFF_DELAY_MS = 3_000;

// A return to the tab fires `visibilitychange` and `focus` back to back, and
// each used to fetch version.json. One look per return is plenty: a wake within
// this long of the last check is skipped.
const WAKE_DEDUPE_MS = 5_000;

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
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

export default function useAutoUpdate() {
  const location = useLocation();
  const editMode = useEditMode();
  const { panel } = useChromePanel();
  const { open: dockOpen } = useActionDock();

  // The deployed build id we've detected as newer than ours and are waiting
  // to apply. Null when we're up to date.
  const pendingRef = useRef(null);

  // A build the reader has already turned down this page: the reload was
  // answered with the browser's "Leave site?" prompt and they stayed. Not
  // asked again until they navigate — re-prompting every poll would be
  // worse than staying stale a while.
  const declinedRef = useRef(null);

  // Latest "safe to reload?" test, kept in a ref so the polling loop reads
  // current edit state without re-arming its interval on every keystroke.
  const isSafeRef = useRef(() => true);
  isSafeRef.current = () => {
    if (editMode.active) return false; // owner is bulk-editing the feed
    if (editMode.editSheet) return false; // a quick-edit sheet is open
    if (panel != null || dockOpen) return false; // a chrome sheet or the dock is open
    if (isReloadHeld()) return false; // a long-running job holds the tab (e.g. the analytics archive build)
    if (documentIsBusy(document)) return false; // a field, player, sheet or draft is in use
    return true;
  };

  const tryReload = (served) => {
    if (declinedRef.current === served) return false;
    return attemptReload(served, {
      isSafe: isSafeRef.current,
      win: window,
      storage: sessionStore(),
      volatile: isStorageVolatile('sessionStorage'),
      onStillHere: () => {
        declinedRef.current = served;
      },
    });
  };
  const tryReloadRef = useRef(tryReload);
  tryReloadRef.current = tryReload;

  // The poll loop + listeners. Armed once; reads live state through refs.
  useEffect(() => {
    if (!import.meta.env.PROD) return; // dev hot-reloads itself
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let lastCheckAt = 0;

    // If we reloaded to reach this build and we're now running it, clear the
    // loop-guard marker so a *future* deploy can reload again.
    const storage = sessionStore();
    if (readReloadTarget(storage) === BUILD_ID) {
      try {
        storage.removeItem(RELOAD_TARGET_KEY);
      } catch {
        /* ignore */
      }
    }

    const check = async () => {
      if (cancelled || document.hidden) return;
      lastCheckAt = Date.now();
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
      tryReloadRef.current(served);
    };

    const onWake = () => {
      if (document.hidden || Date.now() - lastCheckAt < WAKE_DEDUPE_MS) return;
      check();
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

  // Navigating is moving on: a build turned down on the last page may be
  // offered again.
  useEffect(() => {
    declinedRef.current = null;
  }, [location.pathname]);

  // Retry a deferred reload the moment it becomes safe: the reader navigates
  // (edit mode + selection clear on route change) or closes edit mode / the
  // quick-edit sheet / a chrome sheet / the dock. A short delay lets focus
  // settle after the state change.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!pendingRef.current) return;
    const t = setTimeout(() => {
      tryReloadRef.current(pendingRef.current);
    }, 400);
    return () => clearTimeout(t);
  }, [location.pathname, editMode.active, editMode.editSheet, panel, dockOpen]);
}
