import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from './PageShell.jsx';
import GuestbookEntryRow from './GuestbookEntryRow.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { fetchGuestbookEntries, setEntryHidden } from '../lib/guestbook.js';
import { GUESTBOOK_NSID, GUESTBOOK_ENTRY_NSID } from '../config.js';

/**
 * Admin › Guestbook — the moderation desk (`/admin?view=guestbook`).
 *
 * Lists every signature, hidden ones included (dimmed, badged), with
 * hide/unhide per row. Hiding edits the book record's `hidden` list; the
 * signers' records are never touched. The same controls appear on
 * /guestbook itself in owner edit mode — this view exists for working
 * through the whole book without leaving admin.
 */
export default function GuestbookModerationPanel({ agent }) {
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [book, setBook] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    const page = await fetchGuestbookEntries();
    if (!page) {
      setStatus('error');
      return;
    }
    setEntries(page.entries);
    setTotal(page.total);
    setHiddenCount(page.hiddenCount || 0);
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
    if (page) {
      setEntries((prev) => [...(prev || []), ...page.entries]);
      setCursor(page.cursor);
    }
    setLoadingMore(false);
  }

  async function handleSetHidden(entry, hide) {
    await setEntryHidden(agent, entry.uri, hide);
    setEntries((prev) =>
      (prev || []).map((e) => (e.uri === entry.uri ? { ...e, hidden: hide } : e)),
    );
    setHiddenCount((c) => Math.max(0, c + (hide ? 1 : -1)));
    // A hide can auto-create the book record; reflect that without refetching.
    setBook((b) => b || { created: true });
  }

  const publicCount = typeof total === 'number' ? Math.max(0, total - hiddenCount) : null;

  return (
    <PageShell
      title="Guestbook"
      intro="Visitors' signatures, gathered from backlinks. Each lives on its signer's PDS — hiding one only curates what this site renders, by listing its at-uri on the book record."
      headTitle="Guestbook — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{GUESTBOOK_ENTRY_NSID}</code>
        <Link
          to={`/admin?c=${encodeURIComponent(GUESTBOOK_NSID)}&r=self`}
          className="admin-gate-button admin-gate-button-tight"
        >
          Edit the book record
        </Link>
        <Link to="/guestbook" className="admin-gate-button admin-gate-button-tight">
          View /guestbook
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
          {hiddenCount > 0 && (
            <span className="guestbook-hidden-count">
              {' '}· {hiddenCount} hidden · {publicCount} public
            </span>
          )}
        </h2>
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
    </PageShell>
  );
}
