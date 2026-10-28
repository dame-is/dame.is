import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDayLabel, formatDayShortLabel } from '../lib/time.js';
import { useNow } from '../hooks/useNow.js';
import './DayOfLifeHeader.css';

/**
 * The header's visible label, and the fuller one it's announced and hovered
 * by when the visible one is short. Both come from the same local date parts
 * groupByDay buckets by: `date` is the day's newest record, and in the
 * evening that instant is already tomorrow in UTC, so a UTC-built label named
 * the wrong day for anyone west of Greenwich.
 */
export function dayHeaderLabels(date, variant = 'default', now = new Date()) {
  const full = formatDayLabel(date, now);
  const label = variant === 'ledger' ? formatDayShortLabel(date, now) : full;
  return { label, full };
}

/**
 * `variant="ledger"` swaps the long combined label ("Today, July 10,
 * 2026") for the short form ("Today" / a bare date) — the ledger feed
 * layout sets the meta on the same line, so the two have to share the
 * width. The short form keeps the long one as its tooltip and accessible
 * name; the long form needs neither, it already says everything.
 *
 * "Today" / "Yesterday" are relative to a clock that keeps running (useNow),
 * so a page left open past midnight moves them along.
 */
export default function DayOfLifeHeader({
  date,
  meta = null,
  variant = 'default',
}) {
  const now = useNow();
  const day = dayOfLife(date);
  const { label, full } = dayHeaderLabels(date, variant, now);
  const short = label !== full;
  return (
    <header className="day-section-header">
      <h3
        className="day-header"
        title={short ? full : undefined}
        aria-label={short ? full : undefined}
      >
        {label}
      </h3>
      <p className="day-header-meta">
        {meta ? meta : `Day ${day.toLocaleString()}`}
      </p>
    </header>
  );
}
