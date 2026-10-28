import { useSearchParams } from 'react-router-dom';
import { FileText, Image, Link, Quote, Reply, X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useRegisterFeedFilter } from '../hooks/useFeedFilter.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import {
  NONE_SENTINEL,
  POSTING_TYPES,
  postTypesParam,
  resolveActivePostingTypes,
} from '../lib/postingFilter.js';
import './FeedFilters.css';

// The filter's rules live in lib/postingFilter.js; re-exported for the page.
export {
  filterPostingItems,
  postingCategories,
  postingCounts,
  resolveActivePostingTypes,
} from '../lib/postingFilter.js';

const TYPE_LABELS = {
  reply: 'replies',
  // `image` covers videos too (see postingCategories), hence "media".
  image: 'media',
  link: 'links',
  quote: 'quotes',
  text: 'text only',
};

const TYPE_ICONS = {
  reply: Reply,
  image: Image,
  link: Link,
  quote: Quote,
  text: FileText,
};

/**
 * Filter modal host for the /posting page. Mirrors the FeedFilters
 * pattern: registers with the chrome bar's filter trigger and renders
 * its own Modal when the trigger is tapped. Filters are sub-types of
 * the same `posting` verb (replies, image posts, link posts, quote
 * posts, plain text), not separate verbs.
 */
export default function PostingFilters({ counts }) {
  const [params, setParams] = useSearchParams();
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'filter';
  useRegisterFeedFilter();

  const activeTypes = resolveActivePostingTypes(params);
  const usingDefaults = !params.has('postTypes');

  function toggleType(t) {
    const next = new Set(activeTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setTypes(next);
  }

  function setTypes(types) {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', postTypesParam(types));
      return out;
    }, { replace: true });
  }

  function selectAll() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', '');
      return out;
    }, { replace: true });
  }

  function selectNone() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.set('postTypes', NONE_SENTINEL);
      return out;
    }, { replace: true });
  }

  function resetToDefault() {
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete('postTypes');
      return out;
    }, { replace: true });
  }

  const allActive = !usingDefaults && activeTypes.size === POSTING_TYPES.length;
  const noneActive = !usingDefaults && activeTypes.size === 0;

  return (
    <BottomSheet open={open} onClose={closePanel} label="Filter posts" id="chrome-filter-sheet" className="feed-filter-sheet-panel">
      <div className="feed-filter-modal-header">
        <span className="small-caps">filter by post type</span>
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
      <div className="feed-chips" role="group" aria-label="Filter by post type">
        {POSTING_TYPES.map((t) => {
          const active = activeTypes.has(t);
          const count = counts?.[t];
          const Icon = TYPE_ICONS[t];
          return (
            <div
              key={t}
              className={`feed-chip-wrap ${active ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="feed-chip feed-chip-toggle"
                onClick={() => toggleType(t)}
                aria-pressed={active}
              >
                {Icon && <Icon size={13} className="feed-chip-icon" aria-hidden="true" strokeWidth={1.75} />}
                <span className="feed-chip-label small-caps">{TYPE_LABELS[t]}</span>
                {typeof count === 'number' && (
                  <span className="feed-chip-count gutter">{count}</span>
                )}
              </button>
              <button
                type="button"
                className="feed-chip-only"
                onClick={() => setTypes(new Set([t]))}
                aria-label={`Show only ${TYPE_LABELS[t]}`}
                title={`Show only ${TYPE_LABELS[t]}`}
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
