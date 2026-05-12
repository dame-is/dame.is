import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { VERBS, SOURCES, verbConfig } from '../lib/verbRegistry.js';
import VerbIcon from './VerbIcon.jsx';
import FeedSearch from './FeedSearch.jsx';
import './FeedFilters.css';

/**
 * Verb-chip multi-select + source sub-filter + free-text search, all
 * synced to URL params:
 *   ?verbs=posting,blogging&sources=bsky,leaflet&q=mothing
 *
 * The source row only renders for verbs that span more than one source
 * (or when no verb is selected) so single-source filters aren't cluttered
 * by a redundant "bsky" toggle.
 */
export default function FeedFilters({ counts, sourceCounts }) {
  const [params, setParams] = useSearchParams();
  const activeVerbs = new Set((params.get('verbs') || '').split(',').filter(Boolean));
  const activeSources = new Set((params.get('sources') || '').split(',').filter(Boolean));

  function toggleSetParam(key, value) {
    const next = new Set(key === 'verbs' ? activeVerbs : activeSources);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      if (next.size === 0) out.delete(key);
      else out.set(key, Array.from(next).join(','));
      return out;
    }, { replace: true });
  }

  function clear(key) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete(key);
      return out;
    }, { replace: true });
  }

  const sources = visibleSources(activeVerbs);

  return (
    <div className="feed-filters">
      <div className="feed-filters-rows">
        <div className="feed-chips" role="group" aria-label="Filter by verb">
          {VERBS.map((v) => {
            const active = activeVerbs.has(v);
            const count = counts?.[v];
            return (
              <button
                key={v}
                type="button"
                className={`feed-chip ${active ? 'is-active' : ''}`}
                onClick={() => toggleSetParam('verbs', v)}
                aria-pressed={active}
              >
                <VerbIcon verb={v} size={13} className="feed-chip-icon" />
                <span className="feed-chip-label small-caps">{v}</span>
                {typeof count === 'number' && <span className="feed-chip-count gutter">{count}</span>}
              </button>
            );
          })}
          {activeVerbs.size > 0 && (
            <button
              type="button"
              className="feed-chip feed-chip-clear"
              onClick={() => clear('verbs')}
            >
              <X size={13} aria-hidden="true" className="feed-chip-icon" />
              <span className="small-caps">clear</span>
            </button>
          )}
        </div>

        {sources.length > 1 && (
          <div className="feed-chips feed-chips-sources" role="group" aria-label="Filter by source">
            {sources.map((s) => {
              const active = activeSources.has(s);
              const count = sourceCounts?.[s];
              return (
                <button
                  key={s}
                  type="button"
                  className={`feed-chip feed-chip-source ${active ? 'is-active' : ''}`}
                  onClick={() => toggleSetParam('sources', s)}
                  aria-pressed={active}
                >
                  <span className="feed-chip-label small-caps">{s}</span>
                  {typeof count === 'number' && <span className="feed-chip-count gutter">{count}</span>}
                </button>
              );
            })}
            {activeSources.size > 0 && (
              <button
                type="button"
                className="feed-chip feed-chip-clear"
                onClick={() => clear('sources')}
              >
                <X size={13} aria-hidden="true" className="feed-chip-icon" />
                <span className="small-caps">clear</span>
              </button>
            )}
          </div>
        )}
      </div>
      <FeedSearch label="Search the feed" />
    </div>
  );
}

/**
 * Which source chips to show. If the user has selected one or more verbs,
 * limit to the union of those verbs' sources; otherwise show every source
 * in the registry.
 */
function visibleSources(activeVerbs) {
  if (activeVerbs.size === 0) return SOURCES;
  const set = new Set();
  for (const v of activeVerbs) {
    const cfg = verbConfig(v);
    if (!cfg) continue;
    for (const c of cfg.collections) set.add(c.source);
  }
  return Array.from(set);
}

/**
 * Filter helper used by Home.jsx and any other consumer of the registry
 * unified feed. Intersects verb + source filters and a free-text search.
 */
export function filterFeed(items, params) {
  const verbs = (params.get('verbs') || '').split(',').filter(Boolean);
  const sources = (params.get('sources') || '').split(',').filter(Boolean);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((item) => {
    if (verbs.length && !verbs.includes(item.verb)) return false;
    if (sources.length && !sources.includes(item.source || item.payload?.source)) return false;
    if (!q) return true;
    const hay = textForMatch(item).toLowerCase();
    return hay.includes(q);
  });
}

function textForMatch(item) {
  const p = item.payload || {};
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
  ]
    .filter(Boolean)
    .join(' ');
}
