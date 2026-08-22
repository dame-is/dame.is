// A participant's handle, as a link to their page.
//
// Handles are on nearly every Ratioed surface — the lede of a piece, its
// roster, its log, its reach table, the replies the threadgate hid, the replay
// transcript — and each of them was plain text. Every one of those is the same
// question ("who is this, and what else were they in") with the answer already
// on the site, so they all lead to it.
//
// Three accounts have no page and stay as text: the artist, whose records are
// excluded from every count here by construction; the placeholder handle, which
// covers more than one deactivated account and so identifies nobody; and a row
// whose author could not be named at all. See participantHref.

import { Link } from 'react-router-dom';
import { participantHref } from '../lib/ratioedParticipant.js';
import './RatioedHandle.css';

/**
 * @param {object} props
 * @param {string} props.handle    the account, with or without a leading @
 * @param {string} [props.parent]  the essay's own segment, so the link is
 *                                 written under whichever address the reader
 *                                 arrived at — its path or its record key
 * @param {string} [props.className]  the caller's own class, kept
 * @param {React.ReactNode} [props.children]  what to show instead of `@handle`
 */
export default function RatioedHandle({ handle, parent, className, children }) {
  const href = participantHref(handle, parent);
  const body = children ?? `@${handle}`;
  if (!href) return <span className={className}>{body}</span>;
  return (
    <Link className={`ratioed-handle${className ? ` ${className}` : ''}`} to={href}>
      {body}
    </Link>
  );
}
