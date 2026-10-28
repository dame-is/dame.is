import './Figures.css';

/**
 * A band of figures in the DocumentMeta / Ratioed grammar: hairline-ruled
 * cells, the numeral first so every numeral sits on one baseline, a
 * small-caps label beneath it, and an optional one-line note. No boxes.
 *
 * `items` are `{ key, value, label, note?, wide? }`; numbers get thousands
 * separators, strings print as given, a missing value is skipped. A `wide`
 * figure (a time span) takes its own full row on a phone, so the short ones
 * go three-up with nothing left orphaned.
 */
export default function Figures({ items, label }) {
  const shown = (items || []).filter((f) => f && f.value != null && f.value !== '');
  if (!shown.length) return null;
  return (
    <dl className="figures" aria-label={label}>
      {shown.map((f) => (
        <div key={f.key || f.label} className={`figures-cell${f.wide ? ' figures-cell-wide' : ''}`}>
          <dd className="figures-value">{typeof f.value === 'number' ? f.value.toLocaleString('en-US') : f.value}</dd>
          <dt className="figures-label">{f.label}</dt>
          {f.note && <dd className="figures-note">{f.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
