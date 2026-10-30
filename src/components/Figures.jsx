import { Link } from 'react-router-dom';
import { figureSpans } from '../lib/figureSpans.js';
import './Figures.css';

// Two-up under the band's narrow width (Figures.css), whatever it holds wide.
const NARROW_COLUMNS = 2;

// On a desk the band sits on the page grid (theme.css, Figures.css): the
// type area's six columns, a figure to a column, or two columns to a figure
// where any of them carries a note and needs the room. A short last row is
// closed as the band's own rows are. `columns` keeps the count where the band
// isn't on the grid (the admin's) and on a narrow band.
const GRID_COLUMNS = 6;
// A note this short ("≈ 3.6 hrs") still fits a single column.
const NOTE_FITS = 14;

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
  const unit = shown.some((f) => (typeof f.note === 'string' ? f.note.length > NOTE_FITS : f.note)) ? 2 : 1;
  const gridSpans = figureSpans(shown, GRID_COLUMNS / unit).map((n) => n * unit);
  // Four to a row is a table's count (Ratioed's), and a table may hang a
  // column past the type area each side: eight columns, two to a figure.
  const tableSpans = columns === 4 ? figureSpans(shown, 4).map((n) => n * 2) : null;
  const cls = ['figures', dense && 'is-dense', className].filter(Boolean).join(' ');
  return (
    <div className={cls} data-layout={ruled ? 'ruled' : 'inline'} data-columns={columns || undefined}>
      <dl className="figures-grid" aria-label={label} style={ruled ? { '--figures-cols': cols } : undefined}>
        {shown.map((f, i) => {
          const spans = {
            ...(ruled && (wideSpans[i] > 1 || narrowSpans[i] > 1)
              ? { '--span-wide': wideSpans[i], '--span-narrow': narrowSpans[i] }
              : null),
            ...(gridSpans[i] > 1 ? { '--span-grid': gridSpans[i] } : null),
            ...(tableSpans && tableSpans[i] !== 2 ? { '--span-table': tableSpans[i] } : null),
          };
          const link = Boolean(f.to || f.href);
          return (
            <div
              key={f.key || f.label}
              className={`figures-cell${link ? ' is-link' : ''}`}
              style={Object.keys(spans).length ? spans : undefined}
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
