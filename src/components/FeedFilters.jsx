import { useSearchParams } from 'react-router-dom';
import { CornerDownRight, X } from 'lucide-react';
import { VERBS, DEFAULT_HOME_VERBS } from '../lib/verbRegistry.js';
import { selfThreadMembers } from '../lib/threadGrouping.js';
import VerbIcon from './VerbIcon.jsx';
import Modal from './Modal.jsx';
import { useFeedFilter, useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import './FeedFilters.css';

// Sentinel for "show none" so an empty `verbs=` doesn't resolve back to
// "all" (resolveActiveVerbs treats no-value-after-equals as a power-user
// "show everything" shortcut).
const NONE_SENTINEL = '__none__';

// Virtual filter category: replies to others (or standalone self-
// replies that don't participate in a visible thread) read as their
// own first-class chip even though the underlying records still carry
// the `posting` verb. Including it here lets the chip share the same
// toggle / "only" / count machinery as real verbs.
const REPLYING = 'replying';
const FILTER_KEYS = [REPLYING, ...VERBS];

/**
 * Verb-filter modal host. Renders nothing visible itself — the trigger
 * lives in the bottom chrome bar. Mounting this component registers the
 * filter affordance with the context so the chrome bar knows to show
 * its filter button while the host is on screen.
 */
export default function FeedFilters({ counts, estimatedVerbs }) {
  const [params, setParams] = useSearchParams();
  const { open, closeModal } = useFeedFilter();
  useRegisterFeedFilter();

  const activeVerbs = resolveActiveVerbs(params);
  const usingDefaults = !params.has('verbs');

  function toggleVerb(v) {
    const next = new Set(activeVerbs);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setVerbs(next);
  }

  function setVerbs(verbs) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Always write the explicit list once the user starts toggling, so
      // their choice doesn't drift if we ever change the defaults.
      out.set('verbs', Array.from(verbs).join(','));
      return out;
    }, { replace: true });
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Empty value is the resolver's "all" shortcut — keeps the URL
      // short instead of spelling out every verb in the list.
      out.set('verbs', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Sentinel value: explicit "none". Empty list would resolve back to
      // "all" in resolveActiveVerbs, so we use a marker the resolver
      // recognizes.
      out.set('verbs', NONE_SENTINEL);
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('verbs');
      // Legacy `?replies=all` is no longer wired to anything; clear it
      // on a defaults reset so an old URL doesn't linger forever.
      out.delete('replies');
      return out;
    }, { replace: true });
  }

  return (
    <FilterModal
      open={open}
      activeVerbs={activeVerbs}
      counts={counts}
      estimatedVerbs={estimatedVerbs}
      usingDefaults={usingDefaults}
      onToggleVerb={toggleVerb}
      onSelectOnly={(v) => setVerbs(new Set([v]))}
      onSelectAll={selectAll}
      onSelectNone={selectNone}
      onReset={resetToDefault}
      onClose={closeModal}
    />
  );
}

function FilterModal({
  open,
  activeVerbs,
  counts,
  estimatedVerbs,
  usingDefaults,
  onToggleVerb,
  onSelectOnly,
  onSelectAll,
  onSelectNone,
  onReset,
  onClose,
}) {
  const allActive = !usingDefaults && activeVerbs.size === FILTER_KEYS.length;
  const noneActive = !usingDefaults && activeVerbs.size === 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Filter feed"
      className="feed-filter-modal-panel"
      scrimLabel="Close filter"
    >
      <div className="feed-filter-modal-header">
        <span className="small-caps">filter by type</span>
        <button
          type="button"
          className="feed-filter-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="feed-filter-modal-quick" role="group" aria-label="Quick selection">
        <button
          type="button"
          className={`feed-filter-quick-pill ${allActive ? 'is-active' : ''}`}
          onClick={onSelectAll}
        >
          <span className="small-caps">show all</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${noneActive ? 'is-active' : ''}`}
          onClick={onSelectNone}
        >
          <span className="small-caps">show none</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${usingDefaults ? 'is-active' : ''}`}
          onClick={onReset}
        >
          <span className="small-caps">defaults</span>
        </button>
      </div>
      <div className="feed-chips" role="group" aria-label="Filter by verb">
        {FILTER_KEYS.map((v) => {
          const active = activeVerbs.has(v);
          const count = counts?.[v];
          const isEstimate = estimatedVerbs?.has(v);
          return (
            <div
              key={v}
              className={`feed-chip-wrap ${active ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="feed-chip feed-chip-toggle"
                onClick={() => onToggleVerb(v)}
                aria-pressed={active}
              >
                {v === REPLYING ? (
                  <CornerDownRight size={13} strokeWidth={1.75} className="feed-chip-icon" aria-hidden="true" />
                ) : (
                  <VerbIcon verb={v} size={13} className="feed-chip-icon" />
                )}
                <span className="feed-chip-label small-caps">{v}</span>
                {typeof count === 'number' && (
                  <span
                    className={`feed-chip-count gutter ${isEstimate ? 'is-estimate' : ''}`.trim()}
                    title={
                      isEstimate
                        ? 'Estimated from the latest saved snapshot — enable this filter to load the exact count'
                        : undefined
                    }
                    aria-label={isEstimate ? `about ${count}, estimated from snapshot` : undefined}
                  >
                    {isEstimate ? '~' : ''}
                    {count}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="feed-chip-only"
                onClick={() => onSelectOnly(v)}
                aria-label={`Show only ${v}`}
                title={`Show only ${v}`}
              >
                <span className="small-caps">only</span>
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Active verbs derived from the URL params. Empty `verbs` param falls
 * back to the registry's default set so the home feed isn't flooded
 * with high-volume reference verbs (likes, votes) on first load.
 *
 * Setting `verbs=` (with no value) is treated as "all enabled" — useful
 * for power users who want to clear the default filtering without
 * picking each chip individually.
 */
export function resolveActiveVerbs(params) {
  if (!params.has('verbs')) return new Set(DEFAULT_HOME_VERBS);
  const value = params.get('verbs') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(FILTER_KEYS);
  return new Set(raw);
}

/**
 * Filter helper used by Home.jsx and any other consumer of the registry
 * unified feed. Honors the same default-verb fallback as the chip UI so
 * the visible feed and the visible chips agree about what's "active".
 *
 * `replying` is a virtual filter key — posts whose `reply.parent` is
 * set count toward Replying instead of Posting, unless they're part of
 * a visible self-reply thread (then they're treated as Posting
 * continuations). Toggling the Replying chip is what controls reply
 * visibility; the legacy `?replies=all` URL param is no longer wired.
 */
export function filterFeed(items, params, myDid = null) {
  const activeVerbs = resolveActiveVerbs(params);
  const q = (params.get('q') || '').trim().toLowerCase();
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  return items.filter((item) => {
    if (!passesVerb(item, activeVerbs, continuing)) return false;
    if (!q) return true;
    const hay = textForMatch(item).toLowerCase();
    return hay.includes(q);
  });
}

/**
 * True when `item` belongs to one of the active filter buckets. Posts
 * route through either the `replying` or `posting` bucket depending on
 * whether they're standalone replies; everything else falls back to
 * the verb's own bucket.
 */
function passesVerb(item, activeVerbs, continuing) {
  if (item?.verb === 'posting') {
    const isStandaloneReply =
      Boolean(item.payload?.reply?.parent?.uri) && !continuing?.has(item.atUri);
    return activeVerbs.has(isStandaloneReply ? REPLYING : 'posting');
  }
  return activeVerbs.has(item?.verb);
}

/**
 * Per-bucket counts for the chip badges. Posts split into `replying`
 * (standalone replies) and `posting` (originals + thread
 * continuations); other verbs count themselves.
 */
export function feedFilterCounts(items, myDid = null) {
  const continuing = myDid ? selfThreadMembers(items, myDid) : null;
  const out = {};
  for (const item of items || []) {
    if (item?.verb === 'posting') {
      const isStandaloneReply =
        Boolean(item.payload?.reply?.parent?.uri) && !continuing?.has(item.atUri);
      const k = isStandaloneReply ? REPLYING : 'posting';
      out[k] = (out[k] || 0) + 1;
    } else if (item?.verb) {
      out[item.verb] = (out[item.verb] || 0) + 1;
    }
  }
  return out;
}

function textForMatch(item) {
  const p = item.payload || {};
  const subject = item.subject || {};
  // Subject content (post text, author handle, profile bio, …) is just as
  // searchable as the record's own payload — a like over a post should
  // match if the user types the post's body.
  const subjectView = subject.view || {};
  const subjectAuthor = subjectView.author || subjectView; // post view vs profile view
  const subjectRecord = subjectView.record || subject.record?.value || {};
  return [
    p.text,
    p.status,
    p.title,
    p.summary,
    p.description,
    p.body,
    p.trackName,
    p.displayName,
    p.name,
    Array.isArray(p.artists) ? p.artists.map((a) => a?.artistName).join(' ') : '',
    p.releaseName,
    item.source,
    subjectAuthor?.handle,
    subjectAuthor?.displayName,
    subjectRecord?.text,
    subjectRecord?.title,
    subjectRecord?.description,
  ]
    .filter(Boolean)
    .join(' ');
}
