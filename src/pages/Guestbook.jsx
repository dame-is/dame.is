import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { CommentsSkeleton } from '../components/Skeleton.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { usePageContent } from '../hooks/usePageContent.js';
import {
  fetchGuestbookEntries,
  signGuestbook,
  deleteGuestbookEntry,
  graphemeLength,
  ENTRY_TEXT_MAX_GRAPHEMES,
  GUESTBOOK_PAGE_SIZE,
} from '../lib/guestbook.js';
import { getProfile, explorerPathFromAtUri, rkeyFromAtUri } from '../lib/atproto.js';
import { relativeTime } from '../lib/time.js';
import { GUESTBOOK_SUBJECT } from '../config.js';
import './Guestbook.css';

/** The margin-marks a visitor can leave instead of (or besides) a note. */
const MARKS = ['✕', '☾', '✦', '❀', '☺', '♥'];

/**
 * The guestbook. Every signature on this page is a record on the SIGNER's
 * own PDS pointing back at the book on mine — the page just gathers the
 * backlinks (Constellation), hydrates them (Slingshot), and offers a pen.
 */
export default function Guestbook() {
  const { title, intro } = usePageContent('guestbook');
  const { session, agent, did } = useAtprotoSession();

  // --- the book's pages ------------------------------------------------
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(null);
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

  const count = typeof total === 'number' ? total : entries?.length ?? null;

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={GUESTBOOK_SUBJECT}
      headTitle="dame.is hosting a guestbook"
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
        </h2>
        {status === 'loading' ? (
          <CommentsSkeleton rows={4} />
        ) : status === 'error' ? (
          <p className="feed-empty">
            The backlink index is unreachable right now — the signatures are safe on their
            signers' PDSes; try again in a bit.
          </p>
        ) : !entries || entries.length === 0 ? (
          <p className="feed-empty">No signatures yet. The first page is blank — sign it?</p>
        ) : (
          <>
            <ul className="guestbook-list reveal-stagger">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.uri}
                  entry={entry}
                  mine={entry.did === did}
                  onRemove={handleRemove}
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
        Sign in with any AT Protocol account (a Bluesky handle works) to leave a note or just a
        mark that you were here. Your signature is written to <em>your own</em> data server, not
        this site — this page only gathers the backlinks.
      </p>
      <button type="button" className="signin-button" onClick={openAccount}>
        Sign in to sign
      </button>
    </div>
  );
}

/**
 * The pen: a note, an optional one-glyph mark, an optional "signing from".
 * A signature needs at least a note or a mark.
 */
function SignForm({ agent, did, profile, onSigned }) {
  const [text, setText] = useState('');
  const [mark, setMark] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signedAt, setSignedAt] = useState(null);

  const remaining = ENTRY_TEXT_MAX_GRAPHEMES - graphemeLength(text);
  const canSign = !busy && (text.trim() || mark);

  const signingAs = useMemo(() => {
    if (profile?.displayName?.trim()) return profile.displayName.trim();
    if (profile?.handle && profile.handle !== 'handle.invalid') return `@${profile.handle}`;
    return did || '';
  }, [profile, did]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSign) return;
    setBusy(true);
    setError(null);
    try {
      const { uri, value } = await signGuestbook(agent, { text, mark, location });
      onSigned({ uri, did, rkey: rkeyFromAtUri(uri), value });
      setText('');
      setMark('');
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
        <span className="guestbook-form-signer">
          {profile?.avatar && <img className="guestbook-form-avatar" src={profile.avatar} alt="" />}
          {signingAs}
        </span>
      </div>

      <textarea
        className="guestbook-textarea"
        rows={3}
        placeholder="Leave a note… (or just a mark below)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      {remaining < 40 && (
        <span className={`guestbook-remaining gutter${remaining < 0 ? ' guestbook-over' : ''}`}>
          {remaining}
        </span>
      )}

      <div className="guestbook-form-row">
        <div className="guestbook-marks" role="group" aria-label="Leave a mark">
          {MARKS.map((m) => (
            <button
              key={m}
              type="button"
              className={`guestbook-mark${mark === m ? ' guestbook-mark-active' : ''}`}
              aria-pressed={mark === m}
              onClick={() => setMark((cur) => (cur === m ? '' : m))}
              disabled={busy}
            >
              {m}
            </button>
          ))}
        </div>
        <input
          className="guestbook-location signin-input"
          type="text"
          placeholder="signing from… (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={64}
          disabled={busy}
        />
      </div>

      <div className="guestbook-form-actions">
        <button type="submit" className="signin-button" disabled={!canSign}>
          {busy ? 'Signing…' : 'Sign the book'}
        </button>
        {signedAt && !error && (
          <span className="guestbook-signed-note gutter">
            Signed — the record now lives on your PDS.
          </span>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}

/**
 * One signature. Name/handle from the signer's profile (their `signature`
 * field wins when present), timestamp linking into the site's explorer view
 * of the actual record, and either their note, their mark, or both.
 */
function EntryRow({ entry, mine, onRemove }) {
  const [removing, setRemoving] = useState(false);
  const { value, profile } = entry;
  const name =
    value.signature?.trim() ||
    profile?.displayName?.trim() ||
    (profile?.handle && profile.handle !== 'handle.invalid' ? `@${profile.handle}` : null) ||
    shortDid(entry.did);
  const handle = profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
  const explorerPath = explorerPathFromAtUri(entry.uri);

  async function remove() {
    if (removing) return;
    if (!window.confirm('Remove your signature from the book?')) return;
    setRemoving(true);
    try {
      await onRemove(entry);
    } catch {
      setRemoving(false);
    }
  }

  return (
    <li className="guestbook-entry">
      <span className="guestbook-entry-avatar" aria-hidden="true">
        {profile?.avatar ? (
          <img src={profile.avatar} alt="" loading="lazy" width={40} height={40} />
        ) : (
          // Borrow the signer's mark as a stand-in portrait — unless the
          // mark is already the whole message, where doubling it reads odd.
          <span className="guestbook-entry-avatar-fallback">
            {value.text && value.mark ? value.mark : '@'}
          </span>
        )}
      </span>
      <div className="guestbook-entry-body">
        <header className="guestbook-entry-head">
          <span className="guestbook-entry-name">
            {handle ? (
              <a
                href={`https://bsky.app/profile/${handle}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {name}
              </a>
            ) : (
              name
            )}
          </span>
          {handle && name !== `@${handle}` && (
            <span className="guestbook-entry-handle gutter">@{handle}</span>
          )}
          {value.location && (
            <span className="guestbook-entry-location gutter">from {value.location}</span>
          )}
          <span className="guestbook-entry-time gutter">
            {explorerPath ? (
              <Link to={explorerPath}>{relativeTime(value.createdAt)}</Link>
            ) : (
              relativeTime(value.createdAt)
            )}
          </span>
          {mine && (
            <button
              type="button"
              className="guestbook-entry-remove"
              onClick={remove}
              disabled={removing}
              title="Remove your signature"
            >
              {removing ? '…' : 'remove'}
            </button>
          )}
        </header>
        {value.text ? (
          <p className="guestbook-entry-text">
            {value.text}
            {value.mark && <span className="guestbook-entry-inline-mark"> {value.mark}</span>}
          </p>
        ) : value.mark ? (
          <p className="guestbook-entry-mark" title="left their mark">
            {value.mark}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function shortDid(did) {
  if (!did) return 'someone';
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}
