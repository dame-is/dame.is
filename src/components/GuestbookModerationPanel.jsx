import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GuestbookEntryRow from './GuestbookEntryRow.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { fetchGuestbookEntries, setEntryHidden } from '../lib/guestbook.js';
import { GUESTBOOK_NSID, GUESTBOOK_ENTRY_NSID } from '../config.js';

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
    const page = await fetchGuestbookEntries();
    if (!aliveRef.current) return;
    if (!page) {
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
    const page = await fetchGuestbookEntries({ cursor });
    if (!aliveRef.current) return;
    if (page) {
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
        {/* A real navigation off /admin, so it stays an ordinary <Link>. */}
        <Link to="/welcoming" className="admin-gate-button admin-gate-button-tight">
          View /welcoming
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
          lives on its signer's own PDS.
        </p>

        {status === 'loading' ? (
          <AdminRecordListSkeleton rows={5} label="Loading signatures" />
        ) : status === 'error' ? (
          <p className="feed-empty">
            The backlink index is unreachable right now — try again in a bit.
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
