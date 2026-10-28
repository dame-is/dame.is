import { memo, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CornerDownRight } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { XrayTag, XraySubstratePanel } from './XraySubstrate.jsx';
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
import AnisotaLabCard from './cards/AnisotaLabCard.jsx';
import FlushCard from './cards/FlushCard.jsx';
import VerbIcon from './VerbIcon.jsx';
import FeedLedgerRow, { isListenBatch } from './FeedLedgerRow.jsx';
import { batchHref, isObservationBatch } from '../lib/observationBatches.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { getReplyHint } from '../lib/postReplyHint.js';
import { verbConfig, recordHrefFor, nsidFromAtUri } from '../lib/verbRegistry.js';
import { formatWallClockTime } from '../lib/time.js';

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
  AnisotaLabCard,
  FlushCard,
};

/**
 * Renderers that print the row's own time (PostCard's, when a post has no
 * text, is hoisted onto the verb line — see `hoistTime`). Every other card
 * gets its time on the verb line from FeedItem.
 */
const OWN_TIME_RENDERERS = new Set([
  'StatusEntry',
  'PostCard',
  'ReferenceCard',
  'FlushCard',
]);

/**
 * What a tap on the row leaves alone: anything with a behaviour of its own.
 * Media elements are on the list because their native controls aren't
 * elements a selector can see — a tap on a video's play button is a click
 * on the <video>, and it bubbles here like any other.
 */
const ROW_CLICK_IGNORE =
  'a, button, input, textarea, label, select, video, audio, iframe, [role="button"], [role="link"]';

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
  // A collapsed night of moths points at the night itself rather than at
  // whichever sighting happens to sit newest in it — the run has a page, and
  // it's the one a reader wants. (True even for a run of live, not-yet-
  // mirrored observations: the night is derived, so it resolves regardless.)
  const batch = batchHref(item);
  if (batch) return batch;
  // A live iNaturalist observation isn't mirrored to the PDS yet, so it has no
  // record page — its card links out to iNaturalist instead. Skip the row's
  // internal link so a stray tap can't land on a "record not found" page.
  if (item._live) return null;
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
 *
 * `showVerb={false}` is a single-kind page: the cards drop their verb badge
 * and the ledger its repeated gerund. `dayStart`, on such a page's ledger, is
 * the day this row opens (it carries the running date in its margin; see
 * FeedLedgerRow's DiaryDate).
 *
 * The component renders the list item itself, so a list hands it straight
 * to a <ul>. `arriving` (with `arrivalDelay`, in seconds) plays the slide-in
 * for a record that just landed; it's read once, on mount, so the row plays
 * it on its first appearance only, whatever the prop does afterwards.
 * Memoized: a feed re-renders for many reasons that don't touch a given row.
 */
function FeedItem({
  item,
  showVerb = true,
  dayStart = null,
  layout = 'cards',
  onOpenLightbox = null,
  arriving = false,
  arrivalDelay = 0,
}) {
  const navigate = useNavigate();
  const edit = useEditMode();
  const xray = useXray();
  // Ledger-only: whether a collapsed run — a listening session or a night of
  // moths — is showing its full list (see handleRowClick / FeedLedgerRow).
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  // Ids for the ledger row's x-ray cells, which describe the row in x-ray.
  const xrayId = useId();
  // The slide-in's delay while it plays; null once it's done (or if it never
  // started). Dropping the class afterwards matters: a list reorder moves the
  // row's DOM node, and a moved node would restart a CSS animation it still
  // carried.
  const [arrival, setArrival] = useState(() =>
    arriving ? arrivalDelay : null,
  );
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

  // Atmosphere x-ray: while the mode is on, a record-backed row is inspectable.
  // A tap anywhere on it (outside its own links) drills into the substrate
  // rather than navigating, and toggling it off returns to the manifest.
  const xrayActive = xray.active && !!item.atUri;
  const xrayFocused = xrayActive && xray.focusUri === item.atUri;

  function handleXrayClick(e) {
    if (e.defaultPrevented) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest(ROW_CLICK_IGNORE)) return;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0) return;
    xray.toggleFocus(item.atUri);
  }

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
  // A collapsed run of observations does the same: the tap opens the run
  // rather than following it, and each sighting inside gets its own tap.
  const ledgerObsBatch = ledger && isObservationBatch(item);
  const ledgerBatch = ledgerListenBatch || ledgerObsBatch;
  // A photographed observation opens the in-feed image lightbox on tap
  // (like the /mothing page) instead of navigating to its record page. The
  // verb cell keeps linking to the record, so both paths stay reachable.
  const isObservation = item.verb === 'mothing' || item.verb === 'observing';
  const canLightbox =
    ledger &&
    isObservation &&
    !ledgerObsBatch &&
    typeof onOpenLightbox === 'function' &&
    Boolean(item.payload?.photos?.[0]);

  // Make the whole row tappable as a convenience — handy on mobile where the
  // verb badge / timestamp are small hit targets. We bail when the click
  // landed on a nested interactive element (so links inside the card keep
  // working), when text is being selected, or when the click was modified
  // (Cmd/Ctrl/middle-click — let the browser open it in a new tab via the
  // verb badge / timestamp links instead).
  function handleRowClick(e) {
    if (!href && !ledgerBatch && !canLightbox) return;
    if (e.defaultPrevented) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest(ROW_CLICK_IGNORE)) return;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.toString().length > 0) return;
    if (canLightbox) {
      onOpenLightbox(item);
      return;
    }
    if (ledgerBatch) {
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
  // Cards whose renderer prints no time of their own get one in the same
  // place, so every row in a card list can be placed in time the same way.
  // Observations show the wall clock they were logged at, as the ledger
  // does: the record keeps no timezone, so "3h ago" could be hours out for a
  // reader somewhere else.
  const headTime =
    hoistTime || (showVerb && !OWN_TIME_RENDERERS.has(cfg.renderer));
  const headTimeText = !headTime ? null : hoistTime ? (
    <RelativeTimeText value={item.createdAt || item.payload?.indexedAt} />
  ) : isObservation && formatWallClockTime(item.payload?.observedTime) ? (
    formatWallClockTime(item.payload.observedTime)
  ) : item.createdAt ? (
    <RelativeTimeText value={item.createdAt} />
  ) : null;
  const liClassName = [
    'feed-item',
    `feed-item-${item.verb}`,
    ledger ? 'feed-item-ledger' : '',
    ledgerBatch ? 'feed-item-ledger-expandable' : '',
    canLightbox ? 'feed-item-ledger-lightbox' : '',
    item._thread ? 'feed-item-thread' : '',
    ledger && dayStart && !showVerb ? 'feed-item-day-start' : '',
    item._thread?.isFirst ? 'feed-item-thread-first' : '',
    item._thread?.isLast ? 'feed-item-thread-last' : '',
    threadContinuation ? 'feed-item-thread-continuation' : '',
    selectable ? 'feed-item-selectable' : '',
    selected ? 'is-selected' : '',
    xrayFocused ? 'is-xray-focus' : '',
    arrival !== null ? 'feed-item-arriving' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li
      className={liClassName}
      style={arrival ? { '--arrival-delay': `${arrival}s` } : undefined}
      onAnimationEnd={
        arrival !== null
          ? (e) => {
              if (e.target === e.currentTarget) setArrival(null);
            }
          : undefined
      }
      data-verb={item.verb}
      data-nsid={nsidFromAtUri(item.atUri) || undefined}
      data-atproto={item.atUri ? '' : undefined}
      data-at-uri={item.atUri || undefined}
      data-cid={item.cid || undefined}
      data-thread-position={item._thread?.position}
      data-thread-length={item._thread?.length}
      onClickCapture={selectable ? handleSelectCapture : undefined}
      onClick={
        xrayActive
          ? handleXrayClick
          : !selectable && !listeningEdit && (href || ledgerBatch || canLightbox)
            ? handleRowClick
            : undefined
      }
      role={selectable ? 'button' : undefined}
      aria-pressed={selectable ? selected : undefined}
      aria-describedby={ledger && xrayActive ? `${xrayId}-nsid ${xrayId}-key` : undefined}
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
          xrayId={xrayId}
          href={href}
          showVerb={showVerb}
          dayStart={dayStart}
          expanded={ledgerExpanded}
          onToggle={ledgerBatch ? () => setLedgerExpanded((v) => !v) : null}
          onOpenLightbox={onOpenLightbox}
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
        if (!headTimeText) return verbEl;
        const timeEl = href && !listeningEdit ? (
          <Link className="gutter post-card-time feed-item-head-time" to={href}>
            {headTimeText}
          </Link>
        ) : (
          <span className="gutter post-card-time feed-item-head-time">{headTimeText}</span>
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
      {/* X-ray: cards wear a calm substrate tag; the ledger has its own
          in-grid data line (see FeedLedgerRow). Focusing either opens the
          full substrate panel below the row. */}
      {!ledger && xrayActive && (
        <XrayTag atUri={item.atUri} onOpen={() => xray.focus(item.atUri)} />
      )}
      {xrayFocused && (
        <XraySubstratePanel atUri={item.atUri} cid={item.cid} value={item.payload} />
      )}
    </li>
  );
}

export default memo(FeedItem);
