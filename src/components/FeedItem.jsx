import { memo, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useXray } from '../hooks/useXray.jsx';
import { XraySubstratePanel } from './XraySubstrate.jsx';
import FeedLedgerRow, { isListenBatch } from './FeedLedgerRow.jsx';
import { batchHref, isObservationBatch } from '../lib/observationBatches.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { verbConfig, recordHrefFor, nsidFromAtUri } from '../lib/verbRegistry.js';

/**
 * What a tap on the row leaves alone: anything with a behaviour of its own.
 * Media elements are on the list because their native controls aren't
 * elements a selector can see — a tap on a video's play button is a click
 * on the <video>, and it bubbles here like any other.
 */
const ROW_CLICK_IGNORE =
  'a, button, input, textarea, label, select, video, audio, iframe, [role="button"], [role="link"]';

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
 * One feed row: the ledger's (FeedLedgerRow.jsx), on every feed. The cards
 * that once stood beside it as a second layout are gone; the card components
 * live on where a record is shown alone (Record.jsx).
 *
 * `showVerb={false}` is a single-kind page: the ledger drops its repeated
 * gerund.
 *
 * The component renders the list item itself, so a list hands it straight
 * to a <ul>. `arriving` (with `arrivalDelay`, in seconds) plays the slide-in
 * for a record that just landed; it's read once, on mount, so the row plays
 * it on its first appearance only, whatever the prop does afterwards.
 * `arrivingPosts` (the at:// URIs of a folded thread's posts that just
 * landed, space-separated) does the same for posts joining a row that's
 * already on screen.
 * Memoized: a feed re-renders for many reasons that don't touch a given row.
 */
function FeedItem({
  item,
  showVerb = true,
  onOpenLightbox = null,
  arriving = false,
  arrivalDelay = 0,
  arrivingPosts = '',
}) {
  const navigate = useNavigate();
  const edit = useEditMode();
  const xray = useXray();
  // Whether a collapsed run (a listening session or a night of moths) is
  // showing its full list (see handleRowClick / FeedLedgerRow).
  const [expanded, setExpanded] = useState(false);
  // Ids for the row's x-ray cells, which describe the row in x-ray.
  const xrayId = useId();
  // The slide-in's delay while it plays; null once it's done (or if it never
  // started). Dropping the class afterwards matters: a list reorder moves the
  // row's DOM node, and a moved node would restart a CSS animation it still
  // carried.
  const [arrival, setArrival] = useState(() =>
    arriving ? arrivalDelay : null,
  );
  const cfg = verbConfig(item.verb);
  if (!cfg?.renderer) return null;
  const href = hrefFor(item);

  // Owner edit mode: rows become selectable instead of navigable. A tap
  // anywhere on the row (including on nested links, intercepted in the
  // capture phase) toggles selection; the EditModeBar handles the bulk
  // delete / edit actions on whatever is selected.
  //
  // A listening row stands for a session of teal plays, so it selects them
  // all at once, and with its songs listed (edit mode opens the session) a
  // tap on one song selects that play alone.
  const listenBatch = isListenBatch(item);
  const listeningEdit = edit.active && item.verb === 'listening';
  const plays = listeningEdit ? playsOf(item) : [];
  const playsSelected = plays.filter((p) => edit.isSelected(p.atUri)).length;
  const groupState =
    playsSelected === 0 ? 'none' : playsSelected === plays.length ? 'all' : 'some';
  const selectable = edit.active && (listeningEdit ? plays.length > 0 : Boolean(item.atUri));
  const selected = listeningEdit ? groupState === 'all' : selectable && edit.isSelected(item.atUri);

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
    if (!listeningEdit) {
      edit.toggleSelect(item);
      return;
    }
    const song = e.target.closest('[data-play-uri]')?.getAttribute('data-play-uri');
    const play = song && plays.find((p) => p.atUri === song);
    if (play) edit.toggleSelect(play);
    else if (groupState === 'all') edit.deselectMany(plays.map((p) => p.atUri));
    else edit.selectMany(plays);
  }

  // A collapsed listening session repurposes the row tap: instead of
  // navigating, it expands/collapses the session's track list (each track
  // links to its own record page, and the verb cell still links to the
  // session's record).
  // A collapsed run of observations does the same: the tap opens the run
  // rather than following it, and each sighting inside gets its own tap.
  const runBatch = listenBatch || isObservationBatch(item);
  // A photographed observation opens the in-feed image lightbox on tap
  // (like the /mothing page) instead of navigating to its record page. The
  // verb cell keeps linking to the record, so both paths stay reachable.
  const isObservation = item.verb === 'mothing' || item.verb === 'observing';
  const canLightbox =
    isObservation &&
    !isObservationBatch(item) &&
    typeof onOpenLightbox === 'function' &&
    Boolean(item.payload?.photos?.[0]);

  // Make the whole row tappable as a convenience — handy on mobile where the
  // verb and time are small hit targets. We bail when the click landed on a
  // nested interactive element (so links inside the row keep working), when
  // text is being selected, or when the click was modified (Cmd/Ctrl/middle-
  // click — let the browser open it in a new tab via the time link instead).
  function handleRowClick(e) {
    if (!href && !runBatch && !canLightbox) return;
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
    if (runBatch) {
      setExpanded((v) => !v);
      return;
    }
    navigate(href);
  }
  const threadContinuation = item.verb === 'posting' && item._thread?.continuesPrev;
  const liClassName = [
    'feed-item',
    `feed-item-${item.verb}`,
    'feed-item-ledger',
    runBatch ? 'feed-item-ledger-expandable' : '',
    canLightbox ? 'feed-item-ledger-lightbox' : '',
    item._thread ? 'feed-item-thread' : '',
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
  const markState = listeningEdit ? groupState : selected ? 'all' : 'none';
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
          : !selectable && (href || runBatch || canLightbox)
            ? handleRowClick
            : undefined
      }
      role={selectable ? 'button' : undefined}
      aria-pressed={selectable ? (markState === 'some' ? 'mixed' : markState === 'all') : undefined}
      aria-describedby={xrayActive ? `${xrayId}-nsid ${xrayId}-key` : undefined}
    >
      {selectable && (
        <span className={`feed-item-select-mark is-${markState}`} aria-hidden="true">
          {markState === 'all' && <Check size={12} strokeWidth={2.5} />}
          {markState === 'some' && <span className="feed-item-select-dash" />}
        </span>
      )}
      <FeedLedgerRow
        item={item}
        xrayId={xrayId}
        href={href}
        showVerb={showVerb}
        // Edit mode lists a session's songs, so each one can be picked.
        expanded={expanded || (listeningEdit && listenBatch)}
        onToggle={runBatch ? () => setExpanded((v) => !v) : null}
        onOpenLightbox={onOpenLightbox}
        arrivingPosts={arrivingPosts}
      />
      {xrayFocused && (
        <XraySubstratePanel atUri={item.atUri} cid={item.cid} value={item.payload} />
      )}
    </li>
  );
}

/** The teal play records a listening row stands for: a session's plays, or
 *  the one play it is. */
function playsOf(item) {
  const plays = Array.isArray(item.plays) && item.plays.length ? item.plays : [item];
  return plays.filter((p) => p?.atUri);
}

export default memo(FeedItem);
