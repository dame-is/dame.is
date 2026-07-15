import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import GuestbookEntryRow from '../components/GuestbookEntryRow.jsx';
import { CommentsSkeleton } from '../components/Skeleton.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import {
  fetchGuestbookEntries,
  signGuestbook,
  deleteGuestbookEntry,
  setEntryHidden,
  detectCoarseRegion,
  graphemeLength,
  ENTRY_TEXT_MAX_GRAPHEMES,
} from '../lib/guestbook.js';
import { getProfile, rkeyFromAtUri } from '../lib/atproto.js';
import { ME_DID, GUESTBOOK_SUBJECT } from '../config.js';
import './Guestbook.css';

/**
 * The guestbook. Every signature on this page is a record on the SIGNER's
 * own PDS pointing back at the book on mine — the page just gathers the
 * backlinks (Constellation), hydrates them (Slingshot), and offers a pen.
 */
export default function Guestbook() {
  const { title, intro } = usePageContent('guestbook');
  const { session, agent, did } = useAtprotoSession();

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

  // --- the signer ------------------------------------------------------
  // The signed-in visitor's profile, for the "signing as" line and for
  // optimistically rendering their fresh signature before Constellation
  // has indexed it.
  const [myProfile, setMyProfile] = useState(null);
  useEffect(() => {
    setMyProfile(null);
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did)
      .then((p) => {
        if (!cancelled && p) setMyProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  function handleSigned(entry) {
    setEntries((prev) => [{ ...entry, profile: myProfile }, ...(prev || [])]);
    setTotal((t) => (typeof t === 'number' ? t + 1 : t));
  }

  async function handleRemove(entry) {
    if (!agent) return;
    await deleteGuestbookEntry(agent, entry.rkey);
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
      headTitle="dame.is hosting a guestbook"
      selectable
    >
      {session ? (
        <SignForm agent={agent} did={did} profile={myProfile} onSigned={handleSigned} />
      ) : (
        <SignInInvite />
      )}

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
    </PageShell>
  );
}

/**
 * Signed-out state: explain the deal (your words stay on YOUR data server),
 * then hand off to the dock's account panel for the OAuth flow. The current
 * path is stashed so the callback returns the signer here.
 */
function SignInInvite() {
  const { openDock, setView } = useActionDock();

  function openAccount() {
    openDock();
    setView('account');
  }

  return (
    <div className="guestbook-invite">
      <p className="guestbook-invite-text">
        Sign in with any AT Protocol account (a Bluesky handle works) to leave a note that you
        were here. Your signature is written to <em>your own</em> data server, not this site.
        This page only gathers the backlinks.
      </p>
      <button type="button" className="signin-button" onClick={openAccount}>
        Sign in to sign
      </button>
    </div>
  );
}

/**
 * The pen: a note plus an optional "signing from". (Older entries may carry
 * a one-glyph `mark` from the retired picker; the rows still render them.)
 */
function SignForm({ agent, did, profile, onSigned }) {
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signedAt, setSignedAt] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);

  const remaining = ENTRY_TEXT_MAX_GRAPHEMES - graphemeLength(text);
  const canSign = !busy && Boolean(text.trim());

  // Identity in the book is the handle, so that's what the form shows —
  // no avatar, no display name.
  const signingAs = useMemo(() => {
    if (profile?.handle && profile.handle !== 'handle.invalid') return `@${profile.handle}`;
    if (!did) return '';
    return did.length > 24 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
  }, [profile, did]);

  async function detectRegion() {
    if (locating) return;
    setLocating(true);
    setLocError(null);
    try {
      setLocation(await detectCoarseRegion());
    } catch (err) {
      setLocError(err?.message || String(err));
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSign) return;
    setBusy(true);
    setError(null);
    try {
      const { uri, value } = await signGuestbook(agent, { text, location });
      onSigned({ uri, did, rkey: rkeyFromAtUri(uri), value });
      setText('');
      setLocation('');
      setSignedAt(new Date());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guestbook-form" onSubmit={handleSubmit}>
      <div className="guestbook-form-head">
        <span className="small-caps guestbook-form-eyebrow">Signing as</span>
        <span className="guestbook-form-signer">{signingAs}</span>
      </div>

      <textarea
        className="guestbook-textarea"
        rows={3}
        placeholder="Leave a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      {remaining < 40 && (
        <span className={`guestbook-remaining gutter${remaining < 0 ? ' guestbook-over' : ''}`}>
          {remaining}
        </span>
      )}

      <div className="guestbook-location-field">
        <label className="small-caps guestbook-location-label" htmlFor="guestbook-location">
          Signing from
        </label>
        <div className="guestbook-location-row">
          <input
            id="guestbook-location"
            className="guestbook-location signin-input"
            type="text"
            placeholder="a place, in your own words (optional)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={64}
            disabled={busy}
          />
          <button
            type="button"
            className="guestbook-locate"
            onClick={detectRegion}
            disabled={busy || locating}
          >
            <LocateFixed size={14} strokeWidth={1.75} aria-hidden="true" />
            {locating ? 'Locating…' : 'Use my region'}
          </button>
        </div>
        <span className="guestbook-location-hint">
          Shown beside your signature. Write anything, or let &ldquo;Use my region&rdquo; ask
          your browser for location and fill in only your state/region and country, never your
          town or coordinates.
        </span>
        {locError && <p className="signin-error">{locError}</p>}
      </div>

      <div className="guestbook-form-actions">
        <button type="submit" className="signin-button" disabled={!canSign}>
          {busy ? 'Signing…' : 'Sign the book'}
        </button>
        {signedAt && !error && (
          <span className="guestbook-signed-note gutter">
            Signed. The record now lives on your PDS.
          </span>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}

