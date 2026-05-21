import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import { VERBS, DEFAULT_HOME_VERBS } from '../lib/verbRegistry.js';
import VerbIcon from './VerbIcon.jsx';
import FeedSearch from './FeedSearch.jsx';
import './FeedFilters.css';

/**
 * Search + filter button on the main feed. The verb chip grid lives behind
 * a modal so the filter affordance doesn't dominate the viewport — by
 * default the row is just a search input and a single "filter" button.
 *
 * Both controls sync to URL params:
 *   ?verbs=posting,blogging&q=mothing
 *
 * When the `verbs` param is absent, the default verb set from the
 * registry takes over (everything except the high-volume reference
 * verbs like `liking` and `voting`). To see those, the user has to
 * click their chip explicitly in the modal.
 */
export default function FeedFilters({ counts }) {
  const [params, setParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const activeVerbs = resolveActiveVerbs(params);
  const usingDefaults = !params.has('verbs');

  function toggleVerb(v) {
    const next = new Set(activeVerbs);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      // Always write the explicit list once the user starts toggling, so
      // their choice doesn't drift if we ever change the defaults.
      out.set('verbs', Array.from(next).join(','));
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('verbs');
      return out;
    }, { replace: true });
  }

  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setModalOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const activeCount = usingDefaults ? 0 : activeVerbs.size;

  return (
    <div className="feed-filters">
      <FeedSearch label="Search the feed" />
      <button
        type="button"
        className={`feed-filter-button ${activeCount ? 'is-active' : ''}`}
        onClick={() => setModalOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
      >
        <SlidersHorizontal size={14} aria-hidden="true" className="feed-filter-button-icon" />
        <span className="small-caps">filter</span>
        {activeCount > 0 && (
          <span className="feed-filter-button-count gutter">{activeCount}</span>
        )}
      </button>
      {modalOpen && (
        <FilterModal
          activeVerbs={activeVerbs}
          counts={counts}
          usingDefaults={usingDefaults}
          onToggleVerb={toggleVerb}
          onReset={resetToDefault}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function FilterModal({ activeVerbs, counts, usingDefaults, onToggleVerb, onReset, onClose }) {
  return (
    <div className="feed-filter-modal" role="dialog" aria-modal="true" aria-label="Filter feed">
      <button
        type="button"
        className="feed-filter-modal-scrim"
        onClick={onClose}
        aria-label="Close filter"
      />
      <div className="feed-filter-modal-panel">
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
        <div className="feed-chips" role="group" aria-label="Filter by verb">
          {VERBS.map((v) => {
            const active = activeVerbs.has(v);
            const count = counts?.[v];
            return (
              <button
                key={v}
                type="button"
                className={`feed-chip ${active ? 'is-active' : ''}`}
                onClick={() => onToggleVerb(v)}
                aria-pressed={active}
              >
                <VerbIcon verb={v} size={13} className="feed-chip-icon" />
                <span className="feed-chip-label small-caps">{v}</span>
                {typeof count === 'number' && <span className="feed-chip-count gutter">{count}</span>}
              </button>
            );
          })}
        </div>
        {!usingDefaults && (
          <div className="feed-filter-modal-actions">
            <button
              type="button"
              className="feed-filter-modal-reset"
              onClick={onReset}
            >
              <X size={13} aria-hidden="true" className="feed-chip-icon" />
              <span className="small-caps">reset to defaults</span>
            </button>
          </div>
        )}
      </div>
    </div>
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
function resolveActiveVerbs(params) {
  if (!params.has('verbs')) return new Set(DEFAULT_HOME_VERBS);
  const raw = (params.get('verbs') || '').split(',').filter(Boolean);
  if (raw.length === 0) return new Set(VERBS);
  return new Set(raw);
}

/**
 * Filter helper used by Home.jsx and any other consumer of the registry
 * unified feed. Honors the same default-verb fallback as the chip UI so
 * the visible feed and the visible chips agree about what's "active".
 */
export function filterFeed(items, params) {
  const activeVerbs = resolveActiveVerbs(params);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (!activeVerbs.has(item.verb)) return false;
    if (!q) return true;
    const hay = textForMatch(item).toLowerCase();
    return hay.includes(q);
  });
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
