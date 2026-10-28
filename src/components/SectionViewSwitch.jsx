/**
 * "plates · index": a collection page's own view switch, in small caps beside
 * its intro, for this page only (see useSectionView). It replaces the two
 * unlabelled glyphs that appeared only while the compass menu was open.
 */
export default function SectionViewSwitch({ view, onChange, label = 'View' }) {
  return (
    <div className="section-view-switch" role="group" aria-label={label}>
      <button type="button" aria-pressed={view === 'plates'} onClick={() => onChange('plates')}>
        plates
      </button>
      <span aria-hidden="true">·</span>
      <button type="button" aria-pressed={view === 'index'} onClick={() => onChange('index')}>
        index
      </button>
    </div>
  );
}
