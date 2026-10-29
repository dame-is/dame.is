import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDayShortLabel } from '../lib/time.js';
import { longDay, shortDay } from '../lib/ledger.js';
import { useNow } from '../hooks/useNow.js';
import './DayOfLifeHeader.css';

/**
 * What a day header says: the day's date ("Wednesday, Oct 28", the year only
 * when it isn't this one), the relative name it also goes by
 * ("Today", "Yesterday", else null), and `short`, the strip's compact form
 * ("Today", "Oct 25").
 *
 * Every part comes from time.js's own calendar (the day groupByDay files the
 * rows under): `date` is the day's newest record, and in the evening that
 * instant is already tomorrow in UTC, so a UTC-built label named the wrong day
 * for anyone west of Greenwich.
 */
export function dayHeaderLabels(date, now = new Date()) {
  const rel = formatDayShortLabel(date, now);
  const relative = rel === 'Today' || rel === 'Yesterday' ? rel : null;
  const full = longDay(date, now, { shortMonth: true });
  if (!full) return { date: rel, relative, short: rel };
  return { date: full, relative, short: relative || shortDay(date, now) };
}

/**
 * The head of a day in a feed, set like a book's running head: the date on
 * the left and the day-of-life folio on the right, like a page number
 * ("Wednesday, Oct 28 … day 12,228"). Nothing else: what the day holds is
 * in the rows beneath it. `meta` is only for a passing note about the feed
 * itself (the home ledger's "Updating…"), set before the
 * folio. `variant="ledger"` rules it under for the ledger's rows (Feed.css).
 *
 * "Today" and "Yesterday" aren't printed, but they are what the day is called:
 * a screen reader hears "Today, Wednesday, Oct 28", and the chrome, which
 * reads the day in view from `.day-section-header .day-header`, takes
 * `data-day-label` ("Today", "Oct 25") for the ↑ beside it. Both follow a
 * clock that keeps running (useNow), so a page left open past midnight moves
 * them along.
 */
export default function DayOfLifeHeader({
  date,
  meta = null,
  variant = 'default',
}) {
  const now = useNow();
  const day = dayOfLife(date);
  const { date: dateText, relative, short } = dayHeaderLabels(date, now);
  return (
    <header className={`day-section-header day-section-header-${variant}`}>
      <h3
        className="day-header"
        data-day-label={short}
        aria-label={relative ? `${relative}, ${dateText}` : undefined}
      >
        {dateText}
      </h3>
      <p className="day-header-meta">
        {meta && <span className="day-header-note">{meta}</span>}
        <span className="day-header-folio">day {day.toLocaleString('en-US')}</span>
      </p>
    </header>
  );
}
