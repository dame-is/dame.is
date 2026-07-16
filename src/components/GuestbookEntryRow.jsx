import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, MapPinned } from 'lucide-react';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { relativeTime } from '../lib/time.js';
import { useXray } from '../hooks/useXray.jsx';
import { XrayTag, XraySubstratePanel } from './XraySubstrate.jsx';
import '../pages/Guestbook.css';

/**
 * One guestbook signature — shared between /welcoming and the admin moderation
 * panel. The identity sits beside the avatar as a stack — display name, then
 * @handle, then a "from" line — with the timestamp to the right; the note
 * follows; and a small record-CID "fingerprint" (plus any owner controls)
 * closes the row.
 *
 *   - `mine` + `onRemove`          → the signer's own delete button.
 *   - `moderating` + `onSetHidden` → the host's hide/unhide control; hidden
 *                                    rows render dimmed with a badge.
 */
export default function GuestbookEntryRow({ entry, mine, onRemove, moderating, onSetHidden }) {
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [modError, setModError] = useState(null);
  const xray = useXray();
  const { value, profile } = entry;
  // Each signature is a record on the SIGNER's own PDS — x-ray makes that
  // decentralization visible. entry.uri already points at it (a foreign repo).
  const inspectable = xray.active && !!entry.uri;
  const focused = inspectable && xray.focusUri === entry.uri;
  const name =
    value.signature?.trim() ||
    profile?.displayName?.trim() ||
    (profile?.handle && profile.handle !== 'handle.invalid' ? `@${profile.handle}` : null) ||
    shortDid(entry.did);
  const handle = profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
  // Show the handle on its own line unless the display name already IS the handle.
  const showHandle = handle && name !== `@${handle}`;
  const explorerPath = explorerPathFromAtUri(entry.uri);
  // Legacy signatures often lack a createdAt (recovered from the TID rkey where
  // possible); when even that isn't available, skip the time rather than
  // rendering an empty permalink.
  const when = relativeTime(value.createdAt);
  const hasControls = mine || moderating;
  // Flagged by the language filter (or on the host's hidden list): benched from
  // the public view. Both only ever render here in moderation, dimmed.
  const suppressed = entry.hidden || entry.flagged;

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
    <li
      className={`guestbook-entry${suppressed ? ' guestbook-entry-is-hidden' : ''}${focused ? ' is-xray-focus' : ''}`}
      data-nsid={entry.collection || undefined}
      data-atproto={entry.uri ? '' : undefined}
      data-at-uri={entry.uri || undefined}
    >
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
          <div className="guestbook-entry-identity">
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
            {showHandle && <span className="guestbook-entry-handle gutter">@{handle}</span>}
          </div>
          {when && (
            <span className="guestbook-entry-time gutter">
              {explorerPath ? <Link to={explorerPath}>{when}</Link> : when}
            </span>
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

        {(entry.cid || value.location || hasControls) && (
          <div className="guestbook-entry-meta">
            {entry.cid && (
              <span
                className="guestbook-entry-cid gutter"
                title={`Record CID — the record's cryptographic fingerprint:\n${entry.cid}`}
              >
                <Fingerprint size={12} strokeWidth={1.75} aria-hidden="true" />
                {shortCid(entry.cid)}
              </span>
            )}
            {value.location && (
              <span className="guestbook-entry-location gutter">
                <MapPinned size={12} strokeWidth={1.75} aria-hidden="true" />
                {value.location}
              </span>
            )}
            {hasControls && (
              <div className="guestbook-entry-controls">
                {entry.hidden && moderating && (
                  <span className="guestbook-entry-hidden-badge small-caps">hidden</span>
                )}
                {entry.flagged && !entry.hidden && moderating && (
                  <span
                    className="guestbook-entry-flagged-badge small-caps"
                    title="Auto-hidden from public display: flagged by the language filter"
                  >
                    auto-hidden
                  </span>
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
              </div>
            )}
          </div>
        )}
        {modError && <p className="signin-error">{modError}</p>}

        {inspectable && <XrayTag atUri={entry.uri} onOpen={() => xray.focus(entry.uri)} />}
        {focused && <XraySubstratePanel atUri={entry.uri} />}
      </div>
    </li>
  );
}

function shortDid(did) {
  if (!did) return 'someone';
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}

/** A record CID is a ~59-char base32 string; show a head…tail so it reads as a
 *  fingerprint without dominating the row (full value in the title tooltip). */
function shortCid(cid) {
  if (!cid) return '';
  return cid.length > 20 ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : cid;
}
