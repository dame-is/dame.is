import { useSearchParams } from 'react-router-dom';
import BottomSheet from './BottomSheet.jsx';
import FilterIndex, { FilterMeta, FilterQuick } from './FilterIndex.jsx';
import { formatFilterCount, kindsSummary } from '../lib/filterCounts.js';
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

// The index's one line on each type, from postingCategories' own rules.
const TYPE_GLOSSES = {
  reply: 'answers to someone else’s post',
  image: 'photos and video',
  link: 'posts with a link card',
  quote: 'posts quoting another',
  text: 'words alone',
};

/**
 * Filter modal host for the /posting page. Mirrors the FeedFilters
 * pattern: registers with the chrome bar's filter trigger and renders
 * its own sheet when the trigger is tapped, the same index of lines. Filters are sub-types of
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
    <BottomSheet
      open={open}
      onClose={closePanel}
      title="Filter posts"
      meta={<FilterMeta summary={kindsSummary(activeTypes.size, POSTING_TYPES.length, { noun: 'types' })} defaults={usingDefaults} />}
      actions={
        <FilterQuick
          all={allActive}
          none={noneActive}
          defaults={usingDefaults}
          onAll={selectAll}
          onNone={selectNone}
          onDefaults={resetToDefault}
        />
      }
      id="chrome-filter-sheet"
      className="feed-filter-sheet-panel"
      bodyClassName="filter-sheet-content"
    >
      <FilterIndex
        label="Filter by post type"
        groups={[
          {
            key: 'types',
            items: POSTING_TYPES.map((t) => ({
              key: t,
              label: TYPE_LABELS[t],
              gloss: TYPE_GLOSSES[t] || null,
              on: activeTypes.has(t),
              count: formatFilterCount({ count: counts?.[t] }),
            })),
          },
        ]}
        onToggle={toggleType}
        onOnly={(t) => setTypes(new Set([t]))}
      />
    </BottomSheet>
  );
}
