import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { matchesQuery } from './FeedSearch.jsx';
import { workCategory, workSlug } from '../lib/publications.js';
import './FeedFilters.css';

// "Show none" — distinct from an empty `kinds=`, which reads as all of them.
const NONE_SENTINEL = '__none__';

/**
 * Filter modal host for the /creating portfolio. Mirrors PostingFilters
 * — the available "kinds" (project categories) are derived from the
 * loaded records since the registry doesn't enumerate them, then
 * surfaced as toggleable chips inside the chrome-bar filter modal.
 *
 * Nothing to filter by (still loading, or fewer than two kinds) means
 * neither registering nor rendering, so the chrome-bar filter button stays
 * hidden rather than showing a button with no sheet behind it. The
 * registration lives in the sheet for that reason: a hook can't sit behind
 * the early return.
 */
export default function CreatingFilters({ kinds, counts }) {
  if (!kinds || kinds.length < 2) return null;
  return <CreatingFilterSheet kinds={kinds} counts={counts} />;
}

function CreatingFilterSheet({ kinds, counts }) {
  const [params, setParams] = useSearchParams();
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'filter';
  useRegisterFeedFilter();

  const active = resolveActiveKinds(params, kinds);
  const usingDefaults = !params.has('kinds');
  const allActive = !usingDefaults && active.size === kinds.length;
  const noneActive = !usingDefaults && active.size === 0;

  function setKinds(next) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', kindsParamValue(next));
      return out;
    }, { replace: true });
  }

  function toggleKind(k) {
    const next = new Set(active);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('kinds', NONE_SENTINEL);
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('kinds');
      return out;
    }, { replace: true });
  }

  return (
    <BottomSheet open={open} onClose={closePanel} label="Filter projects" id="chrome-filter-sheet" className="feed-filter-sheet-panel">
      <div className="feed-filter-modal-header">
        <span className="small-caps">filter by kind</span>
        <button
          type="button"
          className="feed-filter-modal-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="feed-filter-modal-quick" role="group" aria-label="Quick selection">
        <button
          type="button"
          className={`feed-filter-quick-pill ${allActive ? 'is-active' : ''}`}
          onClick={selectAll}
        >
          <span className="small-caps">show all</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${noneActive ? 'is-active' : ''}`}
          onClick={selectNone}
        >
          <span className="small-caps">show none</span>
        </button>
        <button
          type="button"
          className={`feed-filter-quick-pill ${usingDefaults ? 'is-active' : ''}`}
          onClick={resetToDefault}
        >
          <span className="small-caps">defaults</span>
        </button>
      </div>
      <div className="feed-chips" role="group" aria-label="Filter by kind">
        {kinds.map((k) => {
          const a = active.has(k);
          const count = counts?.[k];
          return (
            <div key={k} className={`feed-chip-wrap ${a ? 'is-active' : ''}`}>
              <button
                type="button"
                className="feed-chip feed-chip-toggle"
                onClick={() => toggleKind(k)}
                aria-pressed={a}
              >
                <span className="feed-chip-label small-caps">{k}</span>
                {typeof count === 'number' && (
                  <span className="feed-chip-count gutter">{count}</span>
                )}
              </button>
              <button
                type="button"
                className="feed-chip-only"
                onClick={() => setKinds(new Set([k]))}
                aria-label={`Show only ${k}`}
                title={`Show only ${k}`}
              >
                <span className="small-caps">only</span>
              </button>
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}

/**
 * The `kinds` param for a set of active kinds. Switching off the last chip
 * leaves an empty set, and an empty value means "all" (it's what "show all"
 * writes), so the empty set is spelled with the sentinel instead — otherwise
 * clearing the last kind would bring every project back.
 */
export function kindsParamValue(kinds) {
  const list = Array.from(kinds || []);
  return list.length ? list.join(',') : NONE_SENTINEL;
}

export function resolveActiveKinds(params, allKinds) {
  const all = Array.isArray(allKinds) ? allKinds : [];
  if (!params.has('kinds')) return new Set(all);
  const value = params.get('kinds') || '';
  if (value === NONE_SENTINEL) return new Set();
  const raw = value.split(',').filter(Boolean);
  if (raw.length === 0) return new Set(all);
  return new Set(raw);
}

export function filterCreatingItems(items, params, allKinds) {
  const active = resolveActiveKinds(params, allKinds);
  const q = (params.get('q') || '').trim().toLowerCase();
  return items.filter((r) => {
    const v = r?.value || {};
    const category = workCategory(v);
    if (category && !active.has(category)) return false;
    const haystack = [
      v.title,
      v.summary,
      v.description,
      v.body,
      category,
      workSlug(v),
      ...(Array.isArray(v.tags) ? v.tags : []),
    ]
      .filter(Boolean)
      .join(' ');
    return matchesQuery(haystack, q);
  });
}
