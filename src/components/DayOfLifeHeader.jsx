import { dayOfLife } from '../lib/dayOfLife.js';
import {
  formatDateLong,
  formatDayLabel,
  formatDayShortLabel,
  relativeDay,
} from '../lib/time.js';
import './DayOfLifeHeader.css';

/**
 * `variant="ledger"` swaps the long combined label ("Today, July 10,
 * 2026") for the short form ("Today" / a bare date) — the ledger feed
 * layout sets the meta on the same line, so the two have to share the
 * width.
 */
export default function DayOfLifeHeader({ date, meta = null, variant = 'default' }) {
  const day = dayOfLife(date);
  const absolute = formatDateLong(date);
  const relative = relativeDay(date);
  const label = variant === 'ledger' ? formatDayShortLabel(date) : formatDayLabel(date);
  return (
    <header className="day-section-header">
      <h3
        className="day-header"
        title={absolute}
        aria-label={`${relative} (${absolute})`}
      >
        {label}
      </h3>
      <p className="day-header-meta">
        {meta ? meta : `Day ${day.toLocaleString()}`}
      </p>
    </header>
  );
}
