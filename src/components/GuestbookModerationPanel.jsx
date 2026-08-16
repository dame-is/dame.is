import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import GuestbookEntryRow from './GuestbookEntryRow.jsx';
import { Skeleton, SkeletonShell } from './Skeleton.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { fetchGuestbookEntries, setEntryHidden } from '../lib/guestbook.js';
import { GUESTBOOK_NSID, GUESTBOOK_ENTRY_NSID } from '../config.js';

/**
 * Ceiling on one page of the book.
 *
 * `fetchGuestbookEntries` is a Constellation backlink page, then one fetch per
 * signer's PDS, then a profile walk, and it takes no signal — so when the index
 * is unreachable the panel used to sit on a skeleton for ~40 SECONDS while every
 * hop exhausted its own network timeout, then report failure. The Front Desk's
 * guestbook tile already gives up at 8s (`GUESTBOOK_DEADLINE_MS` in
 * useAdminData.js), so the same failure was reporting itself twice, five times
 * apart. This is the same number, deliberately: one guestbook, one patience.
 *
 * src/lib/guestbook.js is not this slot's to change, hence a race here rather
 * than an AbortSignal threaded through the fetch. The in-flight requests are not
 * cancelled — they are simply no longer waited on, and `aliveRef` already keeps
 * a late answer from writing to an unmounted panel.
 */
const GUESTBOOK_DEADLINE_MS = 8000;

/** Resolve `fallback` if `promise` has not settled within `ms`. */
function withDeadline(promise, ms, fallback) {
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** Sentinel the deadline resolves with, so a slow load is distinguishable from a failed one. */
const TIMED_OUT = Symbol('guestbook-timeout');

/**
 * A signature-shaped placeholder.
 *
 * The generic `AdminRecordListSkeleton` stood here until now: two flat bars per
 * row on an unruled page, for content that is an avatar, a display name, a
 * handle, a message, a timestamp and a hide control. It promised the wrong
 * shape and the list jumped when the real rows landed. This mirrors
 * `GuestbookEntryRow` — 2.5rem avatar block, two text lines, a timestamp on the
 * right — so the page keeps its geometry across the swap.
 */
function GuestbookRowsSkeleton({ rows = 5 }) {
  return (
    <SkeletonShell label="Loading signatures">
      <ul className="gb-skel">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="gb-skel-row">
            {/* Sizes are PROPS, not classes: `Skeleton` writes width/height
                inline (height defaults to 1em), so a stylesheet cannot reach
                them. */}
            <Skeleton className="gb-skel-avatar" width="2.5rem" height="2.5rem" />
            <div className="gb-skel-body">
              <div className="gb-skel-head">
                <Skeleton width={`${7 + ((i * 3) % 5)}rem`} height="1.05rem" />
                <Skeleton className="gb-skel-time" width="4rem" height="0.8rem" />
              </div>
              <Skeleton block width={`${52 + ((i * 17) % 38)}%`} height="0.9rem" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Admin › Guestbook — the moderation desk (`/admin?view=guestbook`).
 *
 * Lists every signature, hidden ones included (dimmed, badged), with
 * hide/unhide per row. Hiding edits the book record's `hidden` list; the
 * signers' records are never touched. The same controls appear on
 * /welcoming itself in owner edit mode — this view exists for working
 * through the whole book without leaving admin.
 *
 * As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
 * and the book's NSID, and the rail is the way back — so there is no PageShell
 * and no "← All collections" link here. It registers nothing with the status
 * strip either: every control on this surface writes immediately, so there is
 * never anything unsaved for the strip to hold.
 *
 * `GuestbookEntryRow` and `Guestbook.css` are shared with the public /welcoming
 * route and are read-only from here.
 */
export default function GuestbookModerationPanel({ agent }) {
  const { go } = useAdminShell();
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [flaggedCount, setFlaggedCount] = useState(0);
  const [book, setBook] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  // Which kind of failure, so the sentence beside "Try again" is the truth
  // rather than one guess covering both: 'timeout' | 'unreachable'.
  const [failure, setFailure] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // `fetchGuestbookEntries` is a Constellation backlink page, then one fetch per
  // signer's PDS, then a profile walk — many round trips, and no signal to abort
  // them with. A fast flip to another surface therefore lands its results on an
  // unmounted panel unless something says not to, which is what this ref is.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    setFailure(null);
    const page = await withDeadline(fetchGuestbookEntries(), GUESTBOOK_DEADLINE_MS, TIMED_OUT);
    if (!aliveRef.current) return;
    if (!page || page === TIMED_OUT) {
      setFailure(page === TIMED_OUT ? 'timeout' : 'unreachable');
      setStatus('error');
      return;
    }
    setEntries(page.entries);
    setTotal(page.total);
    setHiddenCount(page.hiddenCount || 0);
    setFlaggedCount(page.flaggedCount || 0);
    setBook(page.book);
    setCursor(page.cursor);
    setStatus('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    // Same ceiling as the first page — the next one runs exactly the same hops,
    // and "Turning the page…" for forty seconds is the same lie.
    const page = await withDeadline(
      fetchGuestbookEntries({ cursor }),
      GUESTBOOK_DEADLINE_MS,
      TIMED_OUT,
    );
    if (!aliveRef.current) return;
    if (page && page !== TIMED_OUT) {
      setEntries((prev) => [...(prev || []), ...page.entries]);
      setCursor(page.cursor);
      setFlaggedCount((c) => c + (page.flaggedCount || 0));
    }
    setLoadingMore(false);
  }

  async function handleSetHidden(entry, hide) {
    await setEntryHidden(agent, entry.uri, hide);
    if (!aliveRef.current) return;
    setEntries((prev) =>
      (prev || []).map((e) => (e.uri === entry.uri ? { ...e, hidden: hide } : e)),
    );
    setHiddenCount((c) => Math.max(0, c + (hide ? 1 : -1)));
    // A flagged entry is already counted as auto-hidden; moving it onto (or off)
    // the manual list shifts it between the tallies so `publicCount` stays right.
    if (entry.flagged) setFlaggedCount((c) => Math.max(0, c + (hide ? -1 : 1)));
    // A hide can auto-create the book record; reflect that without refetching.
    setBook((b) => b || { created: true });
  }

  const publicCount =
    typeof total === 'number' ? Math.max(0, total - hiddenCount - flaggedCount) : null;

  // The book record is a normal record on this repo, so it is edited on the
  // generic records surface. `go` is merge-only: `view` has to be cleared by
  // name or it would beat `c` and land straight back here.
  const bookPatch = { view: null, c: GUESTBOOK_NSID, r: 'self', mode: null, for: null };
  const bookHref = `/admin?c=${encodeURIComponent(GUESTBOOK_NSID)}&r=self`;

  return (
    <>
      <div className="admin-toolbar">
        <Link
          to={bookHref}
          className="admin-gate-button admin-gate-button-tight"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            go(bookPatch);
          }}
        >
          Edit the book record
        </Link>
        {/* A real navigation off /admin, so it stays an ordinary <Link> — and
            it is drawn OUTLINED with the top bar's outbound arrow rather than
            as a second filled button. Two identically weighted primaries side
            by side said nothing about the fact that one of them leaves the
            workbench; this borrows the vocabulary "View site" already uses for
            exactly that. */}
        <Link to="/welcoming" className="studio-out">
          View /welcoming
          <ArrowUpRight className="studio-out-glyph" aria-hidden="true" strokeWidth={1.75} />
        </Link>
      </div>

      {status === 'ready' && !book && (
        <p className="placeholder-card">
          The book record (<code>{GUESTBOOK_NSID}/self</code>) doesn't exist yet — run{' '}
          <code>scripts/create-guestbook.mjs</code> to open it with a proper title.
          Hiding an entry below will also create it on the spot with default chrome.
        </p>
      )}

      <section className="guestbook-entries">
        <h2 className="guestbook-entries-heading small-caps">
          {typeof total === 'number'
            ? `${total.toLocaleString()} ${total === 1 ? 'signature' : 'signatures'}`
            : 'Signatures'}
          {(hiddenCount > 0 || flaggedCount > 0) && (
            <span className="guestbook-hidden-count">
              {hiddenCount > 0 && <> · {hiddenCount} hidden</>}
              {flaggedCount > 0 && <> · {flaggedCount} auto-hidden</>}
              {' '}· {publicCount} public
            </span>
          )}
        </h2>

        {/* Deliberately a fact and not a task. `flagged` is recomputed from the
            language filter on every render and is never persisted anywhere, so
            an "awaiting review" queue built on it would have nothing to clear
            and would nag forever. The entries themselves are below, badged. */}
        {flaggedCount > 0 && (
          <p className="admin-field-hint">
            {flaggedCount} auto-hidden by the language filter, not on your hidden list (first page).
          </p>
        )}

        <p className="admin-field-hint">
          <code className="admin-collection-nsid">{GUESTBOOK_ENTRY_NSID}</code> — each signature
          lives on its signer’s own PDS.
        </p>

        {status === 'loading' ? (
          <GuestbookRowsSkeleton rows={5} />
        ) : status === 'error' ? (
          /* A sentence with no control was the whole error state: the only way
             to retry was to leave the surface and come back. */
          <p className="feed-empty gb-error">
            {failure === 'timeout'
              ? 'The backlink index didn’t answer within 8 seconds.'
              : 'The backlink index is unreachable right now.'}{' '}
            <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={load}>
              Try again
            </button>
          </p>
        ) : !entries || entries.length === 0 ? (
          <p className="feed-empty">No signatures yet.</p>
        ) : (
          <>
            <ul className="guestbook-list reveal-stagger">
              {entries.map((entry) => (
                <GuestbookEntryRow
                  key={entry.uri}
                  entry={entry}
                  moderating
                  onSetHidden={handleSetHidden}
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
      </section>
    </>
  );
}
