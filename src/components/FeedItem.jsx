import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CornerDownRight } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import StatusEntry from './StatusEntry.jsx';
import PostCard, { postCardShowsStandaloneTime } from './PostCard.jsx';
import RelativeTimeText from './RelativeTimeText.jsx';
import BlogCard from './BlogCard.jsx';
import ListenRow from './ListenRow.jsx';
import CreatingCard from './CreatingCard.jsx';
import ReferenceCard from './ReferenceCard.jsx';
import MediaCard from './cards/MediaCard.jsx';
import ObservationCard from './cards/ObservationCard.jsx';
import ListCard from './cards/ListCard.jsx';
import GeneratorCard from './cards/GeneratorCard.jsx';
import CommentCard from './cards/CommentCard.jsx';
import VoteCard from './cards/VoteCard.jsx';
import VerbIcon from './VerbIcon.jsx';
import FeedLedgerRow, { isListenBatch } from './FeedLedgerRow.jsx';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { getReplyHint } from '../lib/postReplyHint.js';
import { verbConfig, recordHrefFor, nsidFromAtUri } from '../lib/verbRegistry.js';

/**
 * Per-verb label overrides for the feed's verb column. Most verbs read
 * fine as their registry gerund ("posting", "blogging") but a few want
 * a more natural phrase in front of the card content ("listening to
 * <song>" instead of just "listening | <song>").
 */
const VERB_LABEL_OVERRIDES = {
  listening: 'listening to',
};

/**
 * Renderer name (in the registry) -> component. Adding a new renderer
 * means importing it here and dropping it in this map.
 */
const RENDERERS = {
  StatusEntry,
  PostCard,
  BlogCard,
  ListenRow,
  CreatingCard,
  ReferenceCard,
  MediaCard,
  ObservationCard,
  ListCard,
  GeneratorCard,
  CommentCard,
  VoteCard,
};

function postingReplyVerbLabel(reply) {
  switch (reply.kind) {
    case 'resolved':
      return (
        <>
          replying to{' '}
          <span className="feed-item-verb-reply-handle">@{reply.handle}</span>
        </>
      );
    case 'missing':
      return <>replying to {reply.label}</>;
    case 'unresolved':
    default:
      return <>replying to a post</>;
  }
}

/**
 * Per-record route. Verbs may declare a custom `recordHref` template in
 * the registry (e.g. /blogging/${slug}); everything else falls through
 * to the generic `/{nsid}/{rkey}` form that Record.jsx handles.
 */
function hrefFor(item) {
  return recordHrefFor(item.verb, {
    atUri: item.atUri,
    rkey: rkeyFromAtUri(item.atUri),
    slug: item.payload?.slug,
    source: item.source || item.payload?.source,
    payload: item.payload,
  });
}

/**
 * Polymorphic dispatcher — pick the component for `item.verb` from the
 * registry. The verb badge doubles as the link to the underlying record
 * page (or generic JSON fallback for verbs without a specialized one).
 *
 * `layout` switches the row treatment: 'cards' renders the full card
 * (verb badge + per-verb component), 'ledger' renders the condensed
 * multi-column row (see FeedLedgerRow.jsx). Home decides which to pass
 * — including falling back to 'cards' while owner edit mode is active,
 * so this component never has to reconcile ledger rows with the
 * selection UI.
 */
export default function FeedItem({ item, showVerb = true, layout = 'cards' }) {
  const navigate = useNavigate();
  const edit = useEditMode();
  // Ledger-only: whether a collapsed listening session is showing its
  // full track list (see handleRowClick / FeedLedgerRow).
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const cfg = verbConfig(item.verb);
  if (!cfg) return null;
  const Component = cfg.renderer ? RENDERERS[cfg.renderer] : null;
  if (!Component) return null;
  const href = hrefFor(item);

  // Owner edit mode: rows become selectable instead of navigable. A tap
  // anywhere on the row (including on nested links, intercepted in the
  // capture phase) toggles selection; the EditModeBar handles the bulk
  // delete / edit actions on whatever is selected.
  //
  // Listening rows are the exception: a batch stands in for many teal play
  // records, so ListenRow owns its own per-song / whole-group selection and
  // FeedItem steps aside (no row-level select, and the verb badge stops
  // linking so nothing navigates out mid-selection).
  const listeningEdit = edit.active && item.verb === 'listening';
  const selectable = edit.active && !!item.atUri && !listeningEdit;
  const selected = selectable && edit.isSelected(item.atUri);

  function handleSelectCapture(e) {
    if (!selectable) return;
    // Let a deliberate text selection through rather than hijacking it.
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0) return;
    e.preventDefault();
    e.stopPropagation();
    edit.toggleSelect(item);
  }

  // Condensed ledger row — verb · time · one-line summary. Skips the
  // verb badge / card component entirely; the whole row still
  // navigates via handleRowClick below.
  const ledger = layout === 'ledger';
  // In the ledger, a collapsed listening session repurposes the row tap:
  // instead of navigating, it expands/collapses the session's track list
  // (each expanded track links to its own record page, and the verb cell
  // still links to the session's record).
  const ledgerListenBatch = ledger && isListenBatch(item);

  // Make the whole row tappable as a convenience — handy on mobile where the
  // verb badge / timestamp are small hit targets. We bail when the click
  // landed on a nested interactive element (so links inside the card keep
  // working), when text is being selected, or when the click was modified
  // (Cmd/Ctrl/middle-click — let the browser open it in a new tab via the
  // verb badge / timestamp links instead).
  function handleRowClick(e) {
    if (!href && !ledgerListenBatch) return;
    if (e.defaultPrevented) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest('a, button, input, textarea, label, select, [role="button"], [role="link"]')) return;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0) return;
    if (ledgerListenBatch) {
      setLedgerExpanded((v) => !v);
      return;
    }
    navigate(href);
  }
  // When a post is a continuation of a self-reply thread that is already
  // visible above it in the feed, the "↳ replying to @dame.is" label is
  // redundant noise — the layout already says so. Show a quieter
  // "continuing" marker instead, and let the parent post's badge / verb
  // carry the conversational context.
  const threadContinuation = item.verb === 'posting' && item._thread?.continuesPrev;
  const replyHint =
    item.verb === 'posting' && !threadContinuation ? getReplyHint(item.payload) : null;
  const isReplyVerb = Boolean(replyHint);
  const verbClassName = [
    'feed-item-verb',
    'small-caps',
    isReplyVerb ? 'feed-item-verb-reply' : '',
    threadContinuation ? 'feed-item-verb-thread' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const verbInner = threadContinuation ? (
    <>
      <CornerDownRight size={12} strokeWidth={1.75} className="feed-item-verb-icon" aria-hidden="true" />
      <span className="feed-item-verb-label">continuing</span>
    </>
  ) : isReplyVerb ? (
    <>
      <CornerDownRight size={12} strokeWidth={1.75} className="feed-item-verb-icon" aria-hidden="true" />
      <span className="feed-item-verb-label feed-item-verb-label-reply">
        {postingReplyVerbLabel(replyHint)}
      </span>
    </>
  ) : (
    <>
      <VerbIcon verb={item.verb} size={12} className="feed-item-verb-icon" />
      <span className="feed-item-verb-label">{VERB_LABEL_OVERRIDES[item.verb] || item.verb}</span>
    </>
  );
  // Text-less posts (images / embed only) would otherwise render their
  // timestamp on a lonely row above the embed. Hoist a copy up here so it
  // sits on the same line as the verb gerund ("posting", "reposting",
  // "replying to @handle", …) instead; the card's own standalone-time
  // row is hidden by CSS whenever this hoisted copy exists (see
  // Feed.css).
  const hoistTime = showVerb && cfg.renderer === 'PostCard' && postCardShowsStandaloneTime(item);
  const hoistTs = hoistTime ? item.createdAt || item.payload?.indexedAt : null;
  const liClassName = [
    'feed-item',
    `feed-item-${item.verb}`,
    ledger ? 'feed-item-ledger' : '',
    ledgerListenBatch ? 'feed-item-ledger-expandable' : '',
    item._thread ? 'feed-item-thread' : '',
    item._thread?.isFirst ? 'feed-item-thread-first' : '',
    item._thread?.isLast ? 'feed-item-thread-last' : '',
    threadContinuation ? 'feed-item-thread-continuation' : '',
    selectable ? 'feed-item-selectable' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li
      className={liClassName}
      data-verb={item.verb}
      data-nsid={nsidFromAtUri(item.atUri) || undefined}
      data-thread-position={item._thread?.position}
      data-thread-length={item._thread?.length}
      onClickCapture={selectable ? handleSelectCapture : undefined}
      onClick={
        !selectable && !listeningEdit && (href || ledgerListenBatch)
          ? handleRowClick
          : undefined
      }
      role={selectable ? 'button' : undefined}
      aria-pressed={selectable ? selected : undefined}
    >
      {selectable && (
        <span
          className={`feed-item-select-mark${selected ? ' is-selected' : ''}`}
          aria-hidden="true"
        >
          {selected && <Check size={12} strokeWidth={2.5} />}
        </span>
      )}
      {ledger && (
        <FeedLedgerRow
          item={item}
          href={href}
          expanded={ledgerExpanded}
          onToggle={ledgerListenBatch ? () => setLedgerExpanded((v) => !v) : null}
        />
      )}
      {!ledger && showVerb && (() => {
        const verbEl = href && !listeningEdit ? (
          <Link className={verbClassName} to={href}>
            {verbInner}
          </Link>
        ) : (
          <span className={verbClassName}>
            {verbInner}
          </span>
        );
        if (!hoistTime) return verbEl;
        const timeEl = href ? (
          <Link className="gutter post-card-time feed-item-head-time" to={href}>
            <RelativeTimeText value={hoistTs} />
          </Link>
        ) : (
          <span className="gutter post-card-time feed-item-head-time">
            <RelativeTimeText value={hoistTs} />
          </span>
        );
        return (
          <div className="feed-item-head">
            {verbEl}
            {timeEl}
          </div>
        );
      })()}
      {!ledger && (
        <Component
          {...item}
          verb={item.verb}
          suppressReplyBadge={showVerb ? isReplyVerb || threadContinuation : threadContinuation}
        />
      )}
    </li>
  );
}
