import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAtprotoSession } from './useAtprotoSession.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { getProfile, rkeyFromAtUri } from '../lib/atproto.js';
import { reactionScopeForAccount, signInErrorMessage } from '../lib/oauthClient.js';
import {
  clearPendingReaction,
  latestPerPerson,
  readPendingReaction,
  savePendingReaction,
  tallyReactions,
} from '../lib/experiments.js';
import {
  deleteReactions,
  fetchMyReactions,
  fetchReactions,
  isScopeError,
  sessionCanReact,
  setReactionHidden,
  writeReaction,
} from '../lib/experimentReactions.js';
import { ME_DID } from '../config.js';

/** How many experiments have their reactions gathered at once. */
const GATHER_AT_ONCE = 3;

const NO_REACTIONS = Object.freeze([]);
const IDLE_MINE = Object.freeze({ did: null, status: 'idle', bySubject: new Map() });

/**
 * The reactions to a page's experiments, and the visitor's own.
 *
 * `records` is the experiments on the page (one on a detail page). For each,
 * `viewFor(record)` answers what the page draws:
 *
 *   { status, people, standing, tally, truncated, mine, hidden }
 *
 * `status` is how far the gathering has got: 'loading', 'snapshot' (the
 * build's copy, the live read still out), 'live', 'stale' (the backlink index
 * couldn't be reached, so the build's copy stands) or 'error' (nor is there a
 * copy). `people` is one reaction per person, newest first, the host's hidden
 * ones included (the owner's view shows them dimmed); `standing` is the ones
 * that count, and `tally` counts them. `mine` is the visitor's own reaction to
 * it, or null.
 *
 * Three sources feed it, each trusted for what it knows best:
 *   - the build's snapshot, for a tally on first paint;
 *   - the backlink index, for everybody's reactions as they stand now;
 *   - the signed-in visitor's own repo, for theirs. The index can trail a
 *     write or a delete by seconds, so what the visitor did is read from where
 *     they did it, and laid over whatever the index says about them.
 *
 * `react` and `retract` write to the visitor's PDS. A reaction chosen before
 * signing in waits in sessionStorage across the hop to the visitor's PDS and
 * is written on the way back, so there is no second tap.
 */
export function useExperimentReactions(records) {
  const { session, agent, did, loading: restoring, restore, signIn, signOut } =
    useAtprotoSession();
  const { pathname } = useLocation();
  const isOwner = did === ME_DID;

  // A returning reactor's session waits for a page that can use it.
  useEffect(() => {
    restore();
  }, [restore]);

  const subjects = useMemo(
    () => (Array.isArray(records) ? records : []).map((r) => r?.uri).filter(Boolean),
    [records],
  );
  const subjectsKey = subjects.join('|');

  /* ── everyone's reactions ─────────────────────────────────────────────── */

  // By experiment at-uri: { reactions, total, truncated, status }.
  const [gathered, setGathered] = useState({});
  const gatheredRef = useRef(gathered);
  gatheredRef.current = gathered;

  useEffect(() => {
    const wanted = subjectsKey ? subjectsKey.split('|') : [];
    if (wanted.length === 0) return undefined;
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      const snapshot = await fetchSnapshot('experimenting').catch(() => null);
      if (cancelled) return;
      const seeded =
        snapshot?.reactions && typeof snapshot.reactions === 'object' ? snapshot.reactions : {};
      setGathered((prev) => {
        let next = prev;
        for (const uri of wanted) {
          if (prev[uri] || !Array.isArray(seeded[uri]?.reactions)) continue;
          if (next === prev) next = { ...prev };
          next[uri] = {
            reactions: seeded[uri].reactions,
            total: seeded[uri].total ?? seeded[uri].reactions.length,
            truncated: Boolean(seeded[uri].truncated),
            status: 'snapshot',
          };
        }
        return next;
      });

      // The live read, a few experiments at a time. One already read live this
      // visit (the list grew by one) isn't read again.
      const queue = wanted.filter((uri) => gatheredRef.current[uri]?.status !== 'live');
      const worker = async () => {
        while (queue.length && !cancelled) {
          const uri = queue.shift();
          const known = [
            ...(seeded[uri]?.reactions || []),
            ...(gatheredRef.current[uri]?.reactions || []),
          ];
          const live = await fetchReactions(uri, { known, signal: controller.signal }).catch(
            () => null,
          );
          if (cancelled) return;
          setGathered((prev) => {
            if (live) return { ...prev, [uri]: { ...live, status: 'live' } };
            const held = prev[uri];
            return {
              ...prev,
              [uri]: held
                ? { ...held, status: 'stale' }
                : { reactions: NO_REACTIONS, total: null, truncated: false, status: 'error' },
            };
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(GATHER_AT_ONCE, queue.length) }, worker));
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [subjectsKey]);

  /* ── the visitor's own ────────────────────────────────────────────────── */

  const [mine, setMine] = useState(IDLE_MINE);
  useEffect(() => {
    if (!did) {
      setMine(IDLE_MINE);
      return undefined;
    }
    let cancelled = false;
    setMine({ did, status: 'loading', bySubject: new Map() });
    fetchMyReactions(did).then(
      (bySubject) => {
        if (!cancelled) setMine({ did, status: 'ready', bySubject });
      },
      () => {
        if (!cancelled) setMine({ did, status: 'error', bySubject: new Map() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [did]);
  const mineRef = useRef(mine);
  mineRef.current = mine;

  // What the visitor has done this visit, by experiment at-uri: the reaction
  // they just wrote, or null for one they took back. Kept apart from `mine`
  // so it holds even when their repo couldn't be listed.
  const [written, setWritten] = useState({});
  const writtenRef = useRef(written);
  writtenRef.current = written;
  useEffect(() => {
    setWritten({});
  }, [did]);

  // The visitor's face, for their own line before the index has it.
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

  const signer = useMemo(() => {
    if (!did) return null;
    const handle =
      profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
    return {
      did,
      handle,
      displayName: profile?.displayName?.trim() || '',
      avatar: profile?.avatar || '',
    };
  }, [did, profile]);

  /** Every reaction record the visitor holds for an experiment, newest first. */
  const myRecordsFor = useCallback((subject) => {
    const own = mineRef.current;
    const fresh = writtenRef.current[subject];
    if (fresh !== undefined) return fresh ? [fresh] : [];
    if (own.status === 'ready') return own.bySubject.get(subject) || [];
    return (gatheredRef.current[subject]?.reactions || []).filter((r) => r.did === own.did);
  }, []);

  /* ── moderation (the owner's) ─────────────────────────────────────────── */

  // Hidden lists edited this visit, by experiment at-uri; until one is, the
  // record's own `hidden` stands.
  const [hiddenEdits, setHiddenEdits] = useState({});

  const setHidden = useCallback(
    async (record, reactionUri, hide) => {
      if (!agent || !isOwner) throw new Error('Only the host can hide a reaction.');
      const list = await setReactionHidden(agent, rkeyFromAtUri(record.uri), reactionUri, hide);
      setHiddenEdits((prev) => ({ ...prev, [record.uri]: list }));
    },
    [agent, isOwner],
  );

  /* ── what a page draws ────────────────────────────────────────────────── */

  const viewFor = useCallback(
    (record) => {
      const uri = record?.uri;
      const held = gathered[uri];
      const hidden = new Set(hiddenEdits[uri] ?? record?.value?.hidden ?? []);
      let list = held?.reactions || NO_REACTIONS;
      let own = null;
      if (did) {
        const fresh = written[uri];
        const fromRepo = mine.status === 'ready' && mine.did === did;
        if (fresh !== undefined || fromRepo) {
          own = fresh !== undefined ? fresh : (mine.bySubject.get(uri) || [])[0] || null;
          list = list.filter((r) => r.did !== did);
          if (own) list = [...list, { ...own, profile: signer }];
        } else {
          own = latestPerPerson(list.filter((r) => r.did === did))[0] || null;
        }
      }
      const people = latestPerPerson(list);
      const standing = people.filter((r) => !hidden.has(r.uri));
      return {
        status: held?.status || 'loading',
        people,
        standing,
        tally: tallyReactions(standing),
        truncated: Boolean(held?.truncated),
        mine: own,
        hidden,
      };
    },
    [gathered, hiddenEdits, did, mine, written, signer],
  );

  /* ── reacting ─────────────────────────────────────────────────────────── */

  // The experiment a write is in flight for, and what went wrong last, by
  // experiment at-uri.
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const fail = useCallback((subject, message) => {
    setErrors((prev) => ({ ...prev, [subject]: message }));
  }, []);

  /**
   * Leave (or change) a reaction. `text` undefined keeps the note already on
   * the visitor's reaction, so changing the verdict doesn't drop it. Signed
   * out, it needs `handle`, and goes by way of the visitor's PDS.
   *
   * Resolves to true once the reaction is on the visitor's PDS.
   */
  const react = useCallback(
    async (subject, reaction, { text, handle, returning = false } = {}) => {
      fail(subject, null);
      const current = myRecordsFor(subject);
      const note = text === undefined ? current[0]?.value?.text || '' : text;

      // Off to a PDS, with the reaction left behind to be written on return.
      const hop = async (account) => {
        savePendingReaction({ subject, reaction, text: note });
        try {
          await signIn(account, { returnTo: pathname, scope: reactionScopeForAccount(account) });
        } catch (err) {
          console.warn('[experimenting] sign-in failed to start:', err);
          clearPendingReaction();
          fail(subject, signInErrorMessage(err));
        }
      };

      if (!session) {
        const account = String(handle || '').trim();
        if (!account) {
          fail(subject, 'Add your atproto handle to sign your reaction.');
          return false;
        }
        setBusy(subject);
        await hop(account);
        setBusy(null);
        return false;
      }
      if (!agent) {
        fail(subject, 'Still restoring your session. Try again in a moment.');
        return false;
      }

      // A session from before /experimenting existed can write guestbook
      // entries and nothing else; it needs the one new permission. Not asked
      // for twice in a row: a server that came back without granting it would
      // otherwise bounce the visitor between here and there for good.
      const regrant = async () => {
        if (returning) {
          fail(
            subject,
            'Your account’s server didn’t grant permission to save reactions, so nothing was written.',
          );
          return;
        }
        await hop(did);
      };

      setBusy(subject);
      try {
        if (!(await sessionCanReact(session))) {
          await regrant();
          return false;
        }
        const fresh = await writeReaction(agent, {
          subject,
          reaction,
          text: note,
          replace: current.map((r) => r.rkey),
        });
        setWritten((prev) => ({ ...prev, [subject]: fresh }));
        return true;
      } catch (err) {
        if (isScopeError(err)) {
          await regrant();
          return false;
        }
        console.warn('[experimenting] reaction failed:', err);
        fail(subject, err?.message || 'Couldn’t save your reaction. Try again in a moment.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agent, did, fail, myRecordsFor, pathname, session, signIn],
  );

  /** Take back the visitor's reaction to an experiment. */
  const retract = useCallback(
    async (subject) => {
      fail(subject, null);
      if (!agent) return false;
      const current = myRecordsFor(subject);
      if (current.length === 0) return true;
      setBusy(subject);
      try {
        await deleteReactions(
          agent,
          current.map((r) => r.rkey),
        );
        setWritten((prev) => ({ ...prev, [subject]: null }));
        return true;
      } catch (err) {
        console.warn('[experimenting] retract failed:', err);
        fail(subject, 'Couldn’t take your reaction back. Try again in a moment.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [agent, fail, myRecordsFor],
  );

  // Back from the visitor's PDS with a reaction waiting: write it now. It
  // waits for the page to know the experiment it is for, and for the
  // visitor's own reactions to be read, so the one it replaces is deleted.
  // One-shot: cleared as it is read.
  const resumed = useRef(false);
  const [returnedFor, setReturnedFor] = useState(null);
  useEffect(() => {
    if (resumed.current || !did || !agent) return;
    if (mine.status === 'idle' || mine.status === 'loading') return;
    const pending = readPendingReaction();
    if (!pending || !subjectsKey.split('|').includes(pending.subject)) return;
    resumed.current = true;
    clearPendingReaction();
    setReturnedFor(pending.subject);
    react(pending.subject, pending.reaction, { text: pending.text, returning: true });
  }, [did, agent, mine.status, subjectsKey, react]);

  return {
    viewFor,
    react,
    retract,
    setHidden,
    busy,
    errors,
    signedIn: Boolean(session),
    restoring,
    isOwner,
    signer,
    signOut,
    // The experiment a reaction was just written for on the way back from a
    // sign-in, so the page can bring it into view.
    returnedFor,
  };
}
