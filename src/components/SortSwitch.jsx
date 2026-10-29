/**
 * "sort newest · oldest · …": a collection page's sort, in the same small caps
 * as its SectionViewSwitch and drawn by the same rules, with a quiet lead word
 * so two switches side by side don't read as one. `options` are
 * `{ value, short }`; the chosen one is pressed.
 */
export default function SortSwitch({ value, options, onChange, label = 'Sort by' }) {
  return (
    <div className="section-view-switch sort-switch" role="group" aria-label={label}>
      <span className="sort-switch-lead" aria-hidden="true">
        sort
      </span>
      {options.map((o, i) => (
        <span key={o.value} className="sort-switch-option">
          {i > 0 && <span aria-hidden="true">·</span>}
          <button type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.short}
          </button>
        </span>
      ))}
    </div>
  );
}
