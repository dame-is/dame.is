import { useState } from 'react';
import { Link } from 'react-router-dom';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { registerDate } from '../lib/guestbookRegister.js';
import { clockTime, longDate } from '../lib/recordPlate.js';
import { useXray } from '../hooks/useXray.jsx';
import { XrayTag, XraySubstratePanel } from './XraySubstrate.jsx';
import '../pages/Guestbook.css';

/**
 * One guestbook signature as a line in the register — shared between
 * /welcoming, the admin moderation panel and the sign sheet's proof. Its
 * number hangs in the margin; the note comes first, in the reading size; one
 * small signature line follows (avatar, name, handle, the place in the
 * signer's own words) and closes on the date, which is the permalink. The
 * record's CID stays in x-ray, one click away, rather than on every line.
 *
 *   - `number`                     → the register number (none while it's
 *                                    hidden, or in the admin list).
 *   - `mine` + `onRemove`          → the signer's own delete button.
 *   - `moderating` + `onSetHidden` → the host's hide/unhide control; hidden
 *                                    rows render dimmed with a badge.
 *   - `entering`                   → this signature arrived on the live read
 *                                    after the page had already painted, so it
 *                                    slides in rather than appearing outright.
 *   - `preview`                    → the sign sheet's proof of a line not yet
 *                                    written: no links, no controls, "just
 *                                    now", and a placeholder until there's a
 *                                    note.
 */
export default function GuestbookEntryRow({
  entry,
  number = null,
  mine,
  onRemove,
  moderating,
  onSetHidden,
  entering,
  preview = false,
}) {
  const [removing, setRemoving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [modError, setModError] = useState(null);
  const xray = useXray();
  const { value, profile } = entry;
  // Each signature is a record on the SIGNER's own PDS — x-ray makes that
  // decentralization visible. entry.uri already points at it (a foreign repo).
  const inspectable = !preview && xray.active && !!entry.uri;
  const focused = inspectable && xray.focusUri === entry.uri;
  const handle = profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
  const name =
    value.signature?.trim() ||
    profile?.displayName?.trim() ||
    (handle ? `@${handle}` : null) ||
    (preview ? null : shortDid(entry.did));
  // Show the handle beside the name unless the name already IS the handle.
  const showHandle = handle && name !== `@${handle}`;
  const explorerPath = preview ? null : explorerPathFromAtUri(entry.uri);
  // Legacy signatures often lack a createdAt (recovered from the TID rkey where
  // possible); when even that isn't available, skip the date rather than
  // rendering an empty permalink.
  const when = preview ? 'just now' : registerDate(value.createdAt);
  const whenFull = !preview && value.createdAt ? `${longDate(value.createdAt)} · ${clockTime(value.createdAt)}` : undefined;
  const hasControls = !preview && (mine || moderating);
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
      className={`guestbook-entry${suppressed ? ' guestbook-entry-is-hidden' : ''}${focused ? ' is-xray-focus' : ''}${entering ? ' guestbook-entry-arriving' : ''}${preview ? ' guestbook-entry-preview' : ''}`}
      data-nsid={preview ? undefined : entry.collection || undefined}
      data-atproto={!preview && entry.uri ? '' : undefined}
      data-at-uri={preview ? undefined : entry.uri || undefined}
    >
      <span className="guestbook-entry-number">{number ?? ''}</span>
      <div className="guestbook-entry-body">
        {value.text ? (
          <p className="guestbook-entry-text">
            {value.text}
            {value.mark && <span className="guestbook-entry-inline-mark"> {value.mark}</span>}
          </p>
        ) : value.mark ? (
          <p className="guestbook-entry-mark" title="left their mark">
            {value.mark}
          </p>
        ) : preview ? (
          <p className="guestbook-entry-text guestbook-entry-placeholder">
            Your note appears here as you write it.
          </p>
        ) : null}

        <p className="guestbook-entry-sig">
          <span className="guestbook-entry-avatar" aria-hidden="true">
            {profile?.avatar ? (
              <img src={profile.avatar} alt="" loading="lazy" width={20} height={20} />
            ) : (
              // Borrow the signer's mark as a stand-in portrait — unless the
              // mark is already the whole message, where doubling it reads odd.
              <span className="guestbook-entry-avatar-fallback">
                {value.text && value.mark ? value.mark : '@'}
              </span>
            )}
          </span>
          {name && (
            <span className="guestbook-entry-name">
              {handle && !preview ? (
                <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noreferrer noopener">
                  {name}
                </a>
              ) : (
                name
              )}
            </span>
          )}
          {showHandle && <span className="guestbook-entry-handle">@{handle}</span>}
          {preview && !name && <span className="guestbook-entry-handle">@you</span>}
          {value.location && <span className="guestbook-entry-location">{value.location}</span>}
          {when && (
            <span className="guestbook-entry-time">
              {explorerPath ? (
                <Link to={explorerPath} title={whenFull}>
                  <time dateTime={value.createdAt}>{when}</time>
                </Link>
              ) : (
                <time dateTime={preview ? undefined : value.createdAt}>{when}</time>
              )}
            </span>
          )}
          {hasControls && (
            <span className="guestbook-entry-controls">
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
            </span>
          )}
        </p>
        {modError && <p className="signin-error">{modError}</p>}

        {inspectable && <XrayTag atUri={entry.uri} onOpen={() => xray.focus(entry.uri)} />}
        {focused && <XraySubstratePanel atUri={entry.uri} cid={entry.cid} />}
      </div>
    </li>
  );
}

function shortDid(did) {
  if (!did) return 'someone';
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-6)}`;
}
