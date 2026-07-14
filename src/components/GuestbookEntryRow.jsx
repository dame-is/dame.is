import { useState } from 'react';
import { Link } from 'react-router-dom';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { relativeTime } from '../lib/time.js';
import '../pages/Guestbook.css';

/**
 * One guestbook signature — shared between /guestbook and the admin
 * moderation panel. Name/handle from the signer's profile (their
 * `signature` field wins when present), timestamp linking into the site's
 * explorer view of the actual record, and either their note, their mark,
 * or both.
 *
 *   - `mine` + `onRemove`          → the signer's own delete button.
 *   - `moderating` + `onSetHidden` → the host's hide/unhide control; hidden
 *                                    rows render dimmed with a badge.
 */
export default function GuestbookEntryRow({ entry, mine, onRemove, moderating, onSetHidden }) {
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [modError, setModError] = useState(null);
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

  async function toggleHidden() {
    if (toggling) return;
    setToggling(true);
    setModError(null);
    try {
      await onSetHidden(entry, !entry.hidden);
    } catch (err) {
      setModError(err?.message || String(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <li className={`guestbook-entry${entry.hidden ? ' guestbook-entry-is-hidden' : ''}`}>
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
          {entry.hidden && moderating && (
            <span className="guestbook-entry-hidden-badge small-caps">hidden</span>
          )}
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
          {moderating && (
            <button
              type="button"
              className="guestbook-entry-moderate"
              onClick={toggleHidden}
              disabled={toggling}
              title={
                entry.hidden
                  ? 'Show this signature publicly again'
                  : 'Hide this signature from public display'
              }
            >
              {toggling ? '…' : entry.hidden ? 'unhide' : 'hide'}
            </button>
          )}
        </header>
        {modError && <p className="signin-error">{modError}</p>}
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
