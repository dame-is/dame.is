import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { VERBS, DEFAULT_HOME_VERBS } from '../lib/verbRegistry.js';
import VerbIcon from './VerbIcon.jsx';
import FeedSearch from './FeedSearch.jsx';
import './FeedFilters.css';

/**
 * Chip-row collapse threshold. Showing all 13 verbs by default makes the
 * filter row dominate the viewport on narrow screens; collapsing past
 * the first few keeps the affordance discoverable without burying the
 * feed itself. Any verb that the user has already activated is always
 * visible regardless of position.
 */
const VISIBLE_VERB_LIMIT = 5;

/**
 * Verb-chip multi-select + free-text search, both synced to URL params:
 *   ?verbs=posting,blogging&q=mothing
 *
 * When the `verbs` param is absent, the default verb set from the
 * registry takes over (everything except the high-volume reference
 * verbs like `liking` and `voting`). To see those, the user has to
 * click their chip explicitly.
 */
export default function FeedFilters({ counts }) {
  const [params, setParams] = useSearchParams();
  const [verbsExpanded, setVerbsExpanded] = useState(false);
  const activeVerbs = resolveActiveVerbs(params);

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

  const visibleVerbs = computeVisibleVerbs(VERBS, activeVerbs, verbsExpanded);
  const hiddenCount = VERBS.length - visibleVerbs.length;
  const usingDefaults = !params.has('verbs');

  return (
    <div className="feed-filters">
      <div className="feed-filters-rows">
        <div className="feed-chips" role="group" aria-label="Filter by verb">
          {visibleVerbs.map((v) => {
            const active = activeVerbs.has(v);
            const count = counts?.[v];
            return (
              <button
                key={v}
                type="button"
                className={`feed-chip ${active ? 'is-active' : ''}`}
                onClick={() => toggleVerb(v)}
                aria-pressed={active}
              >
                <VerbIcon verb={v} size={13} className="feed-chip-icon" />
                <span className="feed-chip-label small-caps">{v}</span>
                {typeof count === 'number' && <span className="feed-chip-count gutter">{count}</span>}
              </button>
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="feed-chip feed-chip-more"
              onClick={() => setVerbsExpanded((e) => !e)}
              aria-expanded={verbsExpanded}
            >
              {verbsExpanded ? (
                <>
                  <ChevronUp size={13} aria-hidden="true" className="feed-chip-icon" />
                  <span className="small-caps">less</span>
                </>
              ) : (
                <>
                  <ChevronDown size={13} aria-hidden="true" className="feed-chip-icon" />
                  <span className="small-caps">+{hiddenCount} more</span>
                </>
              )}
            </button>
          )}
          {!usingDefaults && (
            <button
              type="button"
              className="feed-chip feed-chip-clear"
              onClick={resetToDefault}
              title="Reset to default verbs"
            >
              <X size={13} aria-hidden="true" className="feed-chip-icon" />
              <span className="small-caps">reset</span>
            </button>
          )}
        </div>
      </div>
      <FeedSearch label="Search the feed" />
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
 * Which verb chips to render in collapsed mode. Always includes any
 * currently-active verb so the user never sees their selection vanish
 * behind the "+N more" toggle. Otherwise, the first VISIBLE_VERB_LIMIT
 * verbs from the registry order win.
 */
function computeVisibleVerbs(allVerbs, activeVerbs, expanded) {
  if (expanded) return allVerbs;
  const initial = allVerbs.slice(0, VISIBLE_VERB_LIMIT);
  if (activeVerbs.size === 0) return initial;
  const set = new Set(initial);
  for (const v of activeVerbs) set.add(v);
  // Preserve registry order so the chip layout stays stable.
  return allVerbs.filter((v) => set.has(v));
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
