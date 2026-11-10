// What the Sunfarming page hands the game so a player can post a result.
//
// The game (experiments/sunfarming) is a package of its own and knows nothing
// about atproto or this site's sign-in. It takes one optional prop, `social`,
// and shows "Post result" and the boards only when it is given one. This
// builds it: who is signed in, a way to post (by way of the player's PDS if
// they aren't signed in yet), and a way to read a board.
//
// It follows useExperimentReactions, which does the same for reactions: a
// result picked while signed out waits in sessionStorage across the hop to
// the PDS and is written on the way back; a session from before results
// existed is sent to approve the one new permission instead of having its
// write refused.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAtprotoSession } from './useAtprotoSession.jsx';
import { getProfile } from '../lib/atproto.js';
import { isScopeError } from '../lib/experimentReactions.js';
import { playScopeForAccount, signInErrorMessage } from '../lib/oauthClient.js';
import {
  boardKey,
  clearPendingResult,
  fetchBoard,
  leanProfile,
  rankResults,
  readPendingResult,
  savePendingResult,
  sessionCanPost,
  writeResult,
} from '../lib/sunfarmingResults.js';

export function useSunfarmingSocial() {
  const {
    session,
    agent,
    did,
    loading: restoring,
    restore,
    signIn,
    signOut,
  } = useAtprotoSession();
  const { pathname } = useLocation();

  // A visitor's session isn't restored at startup; ask for it here.
  useEffect(() => {
    restore();
  }, [restore]);

  const [profile, setProfile] = useState(null);
  useEffect(() => {
    setProfile(null);
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did)
      .then((p) => {
        if (!cancelled && p) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  const viewer = useMemo(() => {
    if (!did) return null;
    return (
      leanProfile(did, profile) || {
        did,
        handle: '',
        displayName: '',
        avatar: '',
      }
    );
  }, [did, profile]);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // What this visit has posted, by board, so a board read a moment later
  // (before the index has caught up) still shows it.
  const [posted, setPosted] = useState({});
  const postedRef = useRef(posted);
  postedRef.current = posted;
  useEffect(() => {
    setPosted({});
  }, [did]);

  /**
   * Post a finished island. Signed out, it needs `handle` and leaves for the
   * player's PDS; the result is written when they come back. Resolves to
   * true once it is on their repo.
   */
  const post = useCallback(
    async (result, { handle, returning = false } = {}) => {
      setError(null);
      const key = boardKey(result);
      if (!key) {
        setError('That island isn’t finished yet.');
        return false;
      }

      const hop = async (account) => {
        savePendingResult(result);
        try {
          await signIn(account, {
            returnTo: pathname,
            scope: playScopeForAccount(account),
          });
        } catch (err) {
          console.warn('[sunfarming] sign-in failed to start:', err);
          clearPendingResult();
          setError(signInErrorMessage(err));
        }
      };

      if (!session) {
        const account = String(handle || '').trim();
        if (!account) {
          setError('Add your atproto handle to post your result.');
          return false;
        }
        setBusy(true);
        await hop(account);
        setBusy(false);
        return false;
      }
      if (!agent) {
        setError('Still restoring your session. Try again in a moment.');
        return false;
      }

      // A session from before results existed can't write one. Send it to
      // approve the new permission, once; if it comes back still unable,
      // say so instead of going round again.
      const regrant = async () => {
        if (returning) {
          setError(
            'Your account’s server didn’t grant permission to save results, so nothing was posted.',
          );
          return;
        }
        await hop(did);
      };

      setBusy(true);
      try {
        if (!(await sessionCanPost(session))) {
          await regrant();
          return false;
        }
        const written = await writeResult(agent, result);
        setPosted((prev) => ({ ...prev, [key]: written }));
        return true;
      } catch (err) {
        if (isScopeError(err)) {
          await regrant();
          return false;
        }
        console.warn('[sunfarming] posting a result failed:', err);
        setError('Couldn’t post your result. Try again in a moment.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [agent, did, pathname, session, signIn],
  );

  // Back from the PDS with a result waiting: post it, once.
  const resumed = useRef(false);
  const [returned, setReturned] = useState(null);
  useEffect(() => {
    if (resumed.current || !did || !agent) return;
    const pending = readPendingResult();
    if (!pending) return;
    resumed.current = true;
    clearPendingResult();
    post(pending, { returning: true }).then((ok) => {
      if (ok) setReturned(pending);
    });
  }, [did, agent, post]);

  /** Everyone's results for an island: `{ entries, total, truncated }`, or null. */
  const board = useCallback(async (which) => {
    const key = boardKey(which);
    if (!key) return null;
    const found = await fetchBoard(key).catch(() => null);
    const mine = postedRef.current[key];
    if (!mine) return found;
    // The index can trail a write by a few seconds; what was just posted is
    // shown regardless.
    const me = viewerRef.current;
    const others = (found?.entries || []).filter(
      (entry) => entry.did !== mine.did,
    );
    return {
      entries: rankResults([...others, { ...mine, profile: me }]),
      total: Math.max(found?.total ?? 0, others.length + 1),
      truncated: Boolean(found?.truncated),
    };
  }, []);

  const postedKeys = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(posted).map(([key, r]) => [key, r.days]),
      ),
    [posted],
  );

  return useMemo(
    () => ({
      viewer,
      restoring,
      busy,
      error,
      // Board key → the days this visit posted there.
      posted: postedKeys,
      // A result that was posted on the way back from signing in.
      returned,
      post,
      board,
      boardKey,
      signOut,
    }),
    [
      viewer,
      restoring,
      busy,
      error,
      postedKeys,
      returned,
      post,
      board,
      signOut,
    ],
  );
}
