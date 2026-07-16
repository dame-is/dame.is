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
  deleteGuestbookEntry,
  setEntryHidden,
} from '../lib/guestbook.js';
import { ME_DID, GUESTBOOK_SUBJECT } from '../config.js';
import './Guestbook.css';

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
  const [total, setTotal] = useState(null);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setStatus('loading');
    const page = await fetchGuestbookEntries();
    if (!page) {
      setStatus('error');
      return;
    }
    setEntries(page.entries);
    setTotal(page.total);
    setHiddenCount(page.hiddenCount || 0);
    setCursor(page.cursor);
    setStatus('ready');
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const page = await fetchGuestbookEntries({ cursor });
    if (page) {
      setEntries((prev) => [...(prev || []), ...page.entries]);
      setCursor(page.cursor);
      if (page.total != null) setTotal(page.total);
    }
    setLoadingMore(false);
  }

  // A signature just written from the sign sheet arrives via navigation state;
  // drop it on top of the book at once so it shows ahead of the backlink index.
  // A ref of consumed URIs guards against a re-render or a back/forward
  // replaying the same state and inserting it twice.
  const consumedRef = useRef(new Set());
  useEffect(() => {
    const fresh = location.state?.justSigned;
    if (!fresh?.uri || consumedRef.current.has(fresh.uri)) return;
    consumedRef.current.add(fresh.uri);
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
  }

  // The public page renders the curated book; moderation sees everything.
  const visible = entries ? (moderating ? entries : entries.filter((e) => !e.hidden)) : null;
  const count =
    typeof total === 'number' ? Math.max(0, total - hiddenCount) : visible?.length ?? null;

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
        </h2>
        {moderating && (
          <p className="guestbook-moderation-note">
            Edit mode: hiding tucks a signature out of public display by listing it on the
            book record. The signer's own record is untouched.
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
