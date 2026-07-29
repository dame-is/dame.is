import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Signature } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import GuestbookEntryRow from '../components/GuestbookEntryRow.jsx';
import { CommentsSkeleton } from '../components/Skeleton.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import {
  fetchGuestbookEntries,
  fetchGuestbookBook,
  deleteGuestbookEntry,
  setEntryHidden,
} from '../lib/guestbook.js';
import { fetchSnapshot, mergeByKey } from '../lib/snapshot.js';
import { ME_DID, GUESTBOOK_SUBJECT } from '../config.js';
import './Guestbook.css';

// Stable empty set so "nothing new arrived" keeps the same reference between
// paints and rows don't re-key on it.
const NO_ARRIVALS = new Set();
// How long a freshly-arrived signature stays flagged — long enough for the
// entrance to play once, short enough that a later re-render doesn't replay it.
const ARRIVAL_HOLD_MS = 1400;

/**
 * The guestbook. Every signature on this page is a record on the SIGNER's
 * own PDS pointing back at the book on mine — the page just gathers the
 * backlinks (Constellation), hydrates them (Slingshot), and offers a pen.
 *
 * Signing happens in the shared bottom-chrome sign sheet (GuestbookSheet,
 * opened from here and from the home page), so this page shows a call to
 * action rather than an inline form.
 */
export default function Guestbook() {
  const { title, intro } = usePageContent('guestbook');
  const { agent, did } = useAtprotoSession();
  const { openPanel } = useChromePanel();
  const location = useLocation();

  // Owner + the chrome bar's pencil = moderation: hidden entries surface
  // (dimmed) and every signature grows a hide/unhide control.
  const { active: editActive } = useEditMode();
  const moderating = did === ME_DID && editActive;

  // --- the book's pages ------------------------------------------------
  const [entries, setEntries] = useState(null);
  // Mirror of what's on screen, so the painter below can merge onto the
  // current list without re-running every time the list changes.
  const entriesRef = useRef(null);
  const [total, setTotal] = useState(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | stale | error
  const [loadingMore, setLoadingMore] = useState(false);
  entriesRef.current = entries;

  // Signatures that arrived on the live read and weren't in the snapshot, so
  // the page can slide them in the way the home feed does.
  const [newUris, setNewUris] = useState(NO_ARRIVALS);
  const seenUrisRef = useRef(new Set());
  const arrivalTimerRef = useRef(null);
  // What's currently on the page: 'none' → 'snapshot' → 'live'. The snapshot
  // paints only while nothing better has landed; the live read always wins.
  const sourceRef = useRef('none');
  // Whether the reader has turned past the first page. If they have, a late
  // live read merges onto what's showing rather than replacing it, so their
  // "earlier signatures" don't vanish under them.
  const pagedRef = useRef(false);
  // Signatures written from the sign sheet this session that the backlink index
  // hasn't caught up with yet. They ride on top of every page until it has.
  const pendingRef = useRef([]);

  /**
   * Show a page of the book. `page` is whatever `fetchGuestbookEntries` returns
   * — from the build-time snapshot or from the live read — plus the pending
   * optimistic signatures, which drop off as the index catches up with them.
   */
  const paint = useCallback((page, { animate = false } = {}) => {
    const arrived = Array.isArray(page.entries) ? page.entries : [];
    const arrivedUris = new Set(arrived.map((e) => e.uri));
    const pending = pendingRef.current.filter((e) => !arrivedUris.has(e.uri));
    pendingRef.current = pending;

    // Merge (rather than replace) once the reader has paged deeper than this
    // page reaches — the live read only covers the first page, and dropping
    // the rest would rewind their place in the book.
    const next = pagedRef.current
      ? mergeByKey(entriesRef.current, [...pending, ...arrived], (e) => e.uri)
      : [...pending, ...arrived];

    const fresh = new Set();
    for (const entry of next) {
      if (entry.uri && !seenUrisRef.current.has(entry.uri)) fresh.add(entry.uri);
    }
    for (const uri of fresh) seenUrisRef.current.add(uri);

    setEntries(next);
    setTotal(typeof page.total === 'number' ? page.total + pending.length : page.total);
    // The hidden list comes off the book record, so it's whole either way. The
    // flagged tally accrues page by page, though, and this page only covers the
    // first — so once the reader has turned past it, leave their running tally
    // (and their place in the book) alone.
    setHiddenCount(page.hiddenCount || 0);
    if (!pagedRef.current) {
      setFlaggedCount(page.flaggedCount || 0);
      setCursor(page.cursor || null);
    }
    setStatus('ready');

    // The first paint isn't an arrival — every signature is new to the reader.
    if (!animate || fresh.size === 0) return;
    setNewUris(fresh);
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    arrivalTimerRef.current = setTimeout(() => {
      arrivalTimerRef.current = null;
      setNewUris(NO_ARRIVALS);
    }, ARRIVAL_HOLD_MS);
  }, []);

  // Opening the book. Two reads race: the build-time snapshot (one request,
  // paints at once, as old as the last deploy or cron) and the live walk
  // through the backlink index (several round-trips, always current). The
  // snapshot fills the page while the live read is still gathering; whatever
  // the live read carries that the snapshot didn't slides in behind it.
  useEffect(() => {
    let cancelled = false;
    const snapshotPromise = fetchSnapshot('guestbook').catch(() => null);
    const livePromise = fetchGuestbookEntries().catch(() => null);

    (async () => {
      const snap = await snapshotPromise;
      if (!cancelled && sourceRef.current === 'none' && snap?.entries?.length) {
        sourceRef.current = 'snapshot';
        // Paint on the snapshot alone — nothing gets to hold up first paint.
        // Then chase the book record (one cached read, back long before the
        // live walk finishes) and re-curate, so a signature hidden since the
        // build shows for a blink at most. If the book is unreachable the
        // snapshot's own moderation flags stand.
        paint(snap);
        fetchGuestbookBook()
          .then((book) => {
            if (cancelled || !book || sourceRef.current !== 'snapshot') return;
            paint(withCurrentHiddenList(snap, book));
          })
          .catch(() => {});
      }
      const live = await livePromise;
      if (cancelled) return;
      if (live) {
        const hadSnapshot = sourceRef.current === 'snapshot';
        sourceRef.current = 'live';
        paint(live, { animate: hadSnapshot });
      } else if (sourceRef.current === 'none') {
        setStatus('error');
      } else {
        // The snapshot is standing in for an unreachable index; say so.
        setStatus('stale');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paint]);

  // Retire a pending arrival highlight on unmount.
  useEffect(
    () => () => {
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    },
    [],
  );

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const page = await fetchGuestbookEntries({ cursor });
    if (page) {
      pagedRef.current = true;
      for (const entry of page.entries) {
        if (entry.uri) seenUrisRef.current.add(entry.uri);
      }
      setEntries((prev) => [...(prev || []), ...page.entries]);
      setCursor(page.cursor);
      if (page.total != null) setTotal(page.total);
      // Flagged entries surface page by page; add this page's to the tally.
      setFlaggedCount((c) => c + (page.flaggedCount || 0));
    }
    setLoadingMore(false);
  }

  // A signature just written from the sign sheet arrives via navigation state;
  // drop it on top of the book at once so it shows ahead of the backlink index.
  // It also joins the pending list, so a live read that lands before the index
  // has caught up doesn't paint it back out. A ref of consumed URIs guards
  // against a re-render or a back/forward replaying the same state and
  // inserting it twice.
  const consumedRef = useRef(new Set());
  useEffect(() => {
    const fresh = location.state?.justSigned;
    if (!fresh?.uri || consumedRef.current.has(fresh.uri)) return;
    consumedRef.current.add(fresh.uri);
    seenUrisRef.current.add(fresh.uri);
    pendingRef.current = [fresh, ...pendingRef.current];
    setEntries((prev) => {
      const list = prev || [];
      return list.some((e) => e.uri === fresh.uri) ? list : [fresh, ...list];
    });
    setTotal((t) => (typeof t === 'number' ? t + 1 : t));
  }, [location.state]);

  // Returning from the guestbook-only sign-in flow (see signIn's intent),
  // reopen the sheet once the session is live so the visitor can finish signing
  // without a second tap. One-shot: the flag is cleared as it's read.
  useEffect(() => {
    if (!did) return;
    let flagged = false;
    try {
      flagged = sessionStorage.getItem('dame.guestbook.autosign') === '1';
      if (flagged) sessionStorage.removeItem('dame.guestbook.autosign');
    } catch {}
    if (flagged) openPanel('guestbook');
  }, [did, openPanel]);

  async function handleRemove(entry) {
    if (!agent) return;
    await deleteGuestbookEntry(agent, entry.rkey, entry.collection);
    setEntries((prev) => (prev || []).filter((e) => e.uri !== entry.uri));
    setTotal((t) => (typeof t === 'number' && t > 0 ? t - 1 : t));
  }

  async function handleSetHidden(entry, hide) {
    await setEntryHidden(agent, entry.uri, hide);
    setEntries((prev) =>
      (prev || []).map((e) => (e.uri === entry.uri ? { ...e, hidden: hide } : e)),
    );
    setHiddenCount((c) => Math.max(0, c + (hide ? 1 : -1)));
    // A flagged entry is already counted as auto-hidden; when the host promotes
    // it to (or releases it from) the manual list, move it between the tallies
    // so the public count doesn't subtract the same signature twice.
    if (entry.flagged) setFlaggedCount((c) => Math.max(0, c + (hide ? -1 : 1)));
  }

  // The public page renders the curated book — signatures the host hid AND ones
  // the language filter flagged are tucked away; moderation sees everything.
  const visible = entries
    ? moderating
      ? entries
      : entries.filter((e) => !e.hidden && !e.flagged)
    : null;
  const count =
    typeof total === 'number'
      ? Math.max(0, total - hiddenCount - flaggedCount)
      : visible?.length ?? null;

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={GUESTBOOK_SUBJECT}
      headTitle="dame.is welcoming"
      selectable
    >
      <div className="guestbook-cta">
        <button
          type="button"
          className="home-hero-cta-btn"
          onClick={() => openPanel('guestbook')}
        >
          <Signature size={16} strokeWidth={1.75} aria-hidden="true" />
          Sign guestbook
        </button>
      </div>

      <section className="guestbook-entries">
        <h2 className="guestbook-entries-heading small-caps">
          {count != null
            ? `${count.toLocaleString()} ${count === 1 ? 'signature' : 'signatures'}`
            : 'Signatures'}
          {moderating && hiddenCount > 0 && (
            <span className="guestbook-hidden-count"> · {hiddenCount} hidden</span>
          )}
          {moderating && flaggedCount > 0 && (
            <span className="guestbook-hidden-count"> · {flaggedCount} auto-hidden</span>
          )}
        </h2>
        {moderating && (
          <p className="guestbook-moderation-note">
            Edit mode: hiding tucks a signature out of public display by listing it on the
            book record. The signer's own record is untouched. Entries badged{' '}
            <span className="small-caps">auto-hidden</span> tripped the language filter and are
            already kept from public view; hide one to record it on the book too.
          </p>
        )}
        {status === 'loading' ? (
          <CommentsSkeleton rows={4} />
        ) : status === 'error' ? (
          <p className="feed-empty">
            The backlink index is unreachable right now. The signatures are safe on their
            signers' PDSes; try again in a bit.
          </p>
        ) : !visible || visible.length === 0 ? (
          <p className="feed-empty">No signatures yet. The first page is blank. Sign it?</p>
        ) : (
          <>
            <ul className="guestbook-list reveal-stagger">
              {visible.map((entry) => (
                <GuestbookEntryRow
                  key={entry.uri}
                  entry={entry}
                  mine={entry.did === did}
                  onRemove={handleRemove}
                  moderating={moderating}
                  onSetHidden={handleSetHidden}
                  entering={newUris.has(entry.uri)}
                />
              ))}
            </ul>
            {cursor && (
              <button
                type="button"
                className="guestbook-more"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Turning the page…' : 'Earlier signatures'}
              </button>
            )}
          </>
        )}
        {status === 'stale' && (
          <p className="guestbook-stale-note gutter">
            The backlink index is unreachable, so this is the book as it stood at the last
            build — anything signed since is missing, not lost.
          </p>
        )}
      </section>

      <p className="guestbook-source gutter">
        Signatures are gathered from backlinks by{' '}
        <a href="https://microcosm.blue" target="_blank" rel="noopener noreferrer">
          microcosm
        </a>
        .
      </p>
    </PageShell>
  );
}

/**
 * Re-curate a snapshot page against the book's hidden list as it stands NOW.
 *
 * The snapshot froze the moderation state at build time; the book record is a
 * single cached read fetched alongside it. Applying it means a signature hidden
 * (or unhidden) since the build is handled correctly on first paint instead of
 * showing until the live read catches up. Without the book in hand the
 * snapshot's own flags stand. The language-filter `flagged` marks need no such
 * refresh — they're computed from the record's own text, which can't change.
 */
function withCurrentHiddenList(page, book) {
  if (!book) return page;
  const hiddenUris = new Set(Array.isArray(book.value?.hidden) ? book.value.hidden : []);
  const entries = page.entries.map((entry) => ({
    ...entry,
    hidden: hiddenUris.has(entry.uri),
  }));
  return {
    ...page,
    entries,
    hiddenCount: hiddenUris.size,
    flaggedCount: entries.reduce((n, e) => n + (e.flagged && !e.hidden ? 1 : 0), 0),
  };
}
