import { Link } from 'react-router-dom';
import { figureSpans } from '../lib/figureSpans.js';
import './Figures.css';

// Two-up under the band's narrow width (Figures.css), whatever it holds wide.
const NARROW_COLUMNS = 2;

/**
 * The site's one figures primitive: an eyebrow label above an ink numeral in
 * tabular figures, with an optional italic note under it. Cells align to the
 * top, so a note never lifts its numeral off the line the others sit on (the
 * centred /listening tile carrying "≈ 7.7 hrs" rode 11px high). Rendered as a
 * <dl>, as DocumentMeta is.
 *
 * Two layouts:
 *   - 'ruled' (default): a hairline band with a rule between cells and no
 *     outer box. /listening, /logging, /exploring and Ratioed. `columns` sets
 *     how many sit on a row at full width (the item count, up to five, by
 *     default); under about 34rem of band it goes two-up. A short last row is
 *     closed by its last cell spanning the rest, never by empty ruled boxes.
 *   - 'inline': the open colophon row of a page head, figures set apart by
 *     space alone. /mothing, the album shelf, a night.
 *
 * `items` are `{ key, value, label, note?, wide?, to?, href? }`. Numbers get
 * thousands separators, anything else prints as given, and a missing value is
 * skipped. A `wide` figure (a time span) takes a row of its own when two-up.
 * `to` (a route) or `href` makes the whole cell a link, and its numeral the
 * accent: accent is kept for figures you can follow. `dense` sets the
 * numerals a size down, for a second tier stacked under a first.
 */
export default function Figures({ items, label, layout = 'ruled', columns, dense = false, className = '' }) {
  const shown = (items || []).filter((f) => f && f.value != null && f.value !== '');
  if (!shown.length) return null;
  const ruled = layout !== 'inline';
  const cols = Math.max(1, columns || Math.min(shown.length, 5));
  const wideSpans = ruled ? figureSpans(shown, cols) : null;
  const narrowSpans = ruled ? figureSpans(shown, NARROW_COLUMNS, { honorWide: true }) : null;
  const cls = ['figures', dense && 'is-dense', className].filter(Boolean).join(' ');
  return (
    <div className={cls} data-layout={ruled ? 'ruled' : 'inline'}>
      <dl className="figures-grid" aria-label={label} style={ruled ? { '--figures-cols': cols } : undefined}>
        {shown.map((f, i) => {
          const spans =
            ruled && (wideSpans[i] > 1 || narrowSpans[i] > 1)
              ? { '--span-wide': wideSpans[i], '--span-narrow': narrowSpans[i] }
              : undefined;
          const link = Boolean(f.to || f.href);
          return (
            <div
              key={f.key || f.label}
              className={`figures-cell${link ? ' is-link' : ''}`}
              style={spans}
            >
              <dt className="figures-label eyebrow">{f.label}</dt>
              <dd className="figures-value">
                <FigureValue figure={f} />
              </dd>
              {f.note && <dd className="figures-note">{f.note}</dd>}
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function FigureValue({ figure }) {
  const text = typeof figure.value === 'number' ? figure.value.toLocaleString('en-US') : figure.value;
  if (figure.to) {
    return (
      <Link className="figures-link" to={figure.to}>
        {text}
      </Link>
    );
  }
  if (figure.href) {
    return (
      <a className="figures-link" href={figure.href}>
        {text}
      </a>
    );
  }
  return text;
}
