import { Check } from 'lucide-react';

/**
 * A filter sheet's body, set as an index rather than a cloud of chips: ruled
 * lines under group heads, each a box, the name, a one-line gloss, dot
 * leaders and the count in tabular figures, with "only" as its own target at
 * the end. Two columns where there's room, one on a phone.
 *
 * On and off are told apart by the box (☑ / ☐) and the weight of the type,
 * not by a tint alone; an off line goes quiet rather than turning into the
 * brightest thing on the sheet, as the white off-chips did.
 *
 * `groups` are `{ key, label?, items }`, a single unlabelled group for a flat
 * list; `items` are `{ key, label, gloss?, count?: { text, spoken }, on }`.
 * `onToggle(key)` and `onOnly(key)` do the rest; `note` is the footer line.
 */
export default function FilterIndex({ groups, onToggle, onOnly, note, label }) {
  return (
    <div className="filter-index-wrap">
      <div className="filter-index" role="group" aria-label={label}>
        {groups.map((g) => (
          <section key={g.key} className="filter-group">
            {g.label && <h3 className="filter-group-title eyebrow">{g.label}</h3>}
            <ul className="filter-lines">
              {g.items.map((item) => (
                <FilterLine key={item.key} item={item} onToggle={onToggle} onOnly={onOnly} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {note && <p className="filter-note">{note}</p>}
    </div>
  );
}

function FilterLine({ item, onToggle, onOnly }) {
  const { key, label, gloss, count, on } = item;
  return (
    <li className={`filter-line${on ? ' is-checked' : ''}`}>
      <button type="button" className="filter-toggle" aria-pressed={on} onClick={() => onToggle(key)}>
        <span className="filter-box" aria-hidden="true">
          {on && <Check size={11} strokeWidth={2.5} />}
        </span>
        <span className="filter-name">{label}</span>
        {gloss && <span className="filter-gloss">{gloss}</span>}
        <span className="filter-leader" aria-hidden="true" />
        {count && (
          <span className="filter-count">
            <span aria-hidden="true">{count.text}</span>
            <span className="visually-hidden">, {count.spoken}</span>
          </span>
        )}
      </button>
      <button
        type="button"
        className="filter-only"
        onClick={() => onOnly(key)}
        aria-label={`Show only ${label}`}
        title={`Show only ${label}`}
      >
        only
      </button>
    </li>
  );
}

/**
 * The header's meta: "14 of 17 kinds", then " · the defaults" when it is.
 * The second half gives way on a narrow phone, where the Defaults button
 * beside it already says as much by being on.
 */
export function FilterMeta({ summary, defaults }) {
  return (
    <>
      {summary}
      {defaults && <span className="filter-meta-defaults"> · the defaults</span>}
    </>
  );
}

/**
 * The header's quick selections, "All · None · Defaults", as text buttons;
 * the one that describes the current selection is marked on.
 */
export function FilterQuick({ all, none, defaults, onAll, onNone, onDefaults }) {
  return (
    <div className="filter-quick" role="group" aria-label="Quick selection">
      <QuickButton on={all} onClick={onAll}>
        All
      </QuickButton>
      <span className="filter-quick-sep" aria-hidden="true">
        ·
      </span>
      <QuickButton on={none} onClick={onNone}>
        None
      </QuickButton>
      <span className="filter-quick-sep" aria-hidden="true">
        ·
      </span>
      <QuickButton on={defaults} onClick={onDefaults}>
        Defaults
      </QuickButton>
    </div>
  );
}

function QuickButton({ on, onClick, children }) {
  return (
    <button
      type="button"
      className={`btn btn--text btn--sm filter-quick-btn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
