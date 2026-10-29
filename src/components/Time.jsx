import { useNow } from '../hooks/useNow.js';
import {
  formatDateFull,
  formatDateShort,
  formatStamp,
  formatTime,
  isDayOnly,
  readerTime,
  relativeTime,
  toIso,
} from '../lib/time.js';
import './Time.css';

/**
 * One date or time, printed in the house style on Dame's clock (see
 * lib/time.js) and marked up as a `<time>` with a machine-readable dateTime.
 *
 *   variant="clock"      3:17 pm
 *   variant="date"       January 29, 2025
 *   variant="dateShort"  Jan 29, 2025
 *   variant="relative"   19h ago, 3d ago; Jan 29, 2025 past 30 days
 *
 * The tooltip carries the moment in full — "Monday, October 26, 2026 · 5:36
 * pm" — and, for a reader whose clock reads differently, theirs on a second
 * line. Pass `title={null}` to leave it off, or a string to replace it.
 *
 * `tabular` sets tabular figures, for a column of times whose colons should
 * line up. `compact` (relative only) drops the trailing " ago" on a narrow
 * screen, "33m" for "33m ago", where the column has no room for it.
 * `children` replaces the printed text and keeps the rest: an observation's
 * time is its recorded wall-clock, printed as recorded.
 */
export default function Time({ value, variant = 'date', ...props }) {
  if (variant === 'relative') return <RelativeTime value={value} {...props} />;
  const text = variant === 'clock'
    ? formatTime(value)
    : variant === 'dateShort'
      ? formatDateShort(value)
      : formatDateFull(value);
  return <TimeElement value={value} text={text} {...props} />;
}

// Split out so only a relative time rides the minute clock; a feed of plain
// clocks and dates has no reason to re-render once a minute.
function RelativeTime({ value, compact = false, ...props }) {
  const now = useNow();
  const text = relativeTime(value, now);
  const ago = compact && /^(.+) ago$/.exec(text);
  return (
    <TimeElement
      value={value}
      text={
        ago ? (
          <>
            {ago[1]}
            <span className="time-ago-suffix"> ago</span>
          </>
        ) : text
      }
      {...props}
    />
  );
}

function TimeElement({ value, text, title, tabular = false, className = '', children }) {
  if (!text) return null;
  const tip = title === undefined ? stampTitle(value) : title;
  const classes = [className, tabular ? 'time-tabular' : ''].filter(Boolean).join(' ');
  return (
    <time dateTime={machineDate(value)} title={tip || undefined} className={classes || undefined}>
      {children ?? text}
    </time>
  );
}

/** A day stored as a day is written as one; anything else as a full ISO instant. */
function machineDate(value) {
  if (isDayOnly(value)) return value.slice(0, 10);
  return toIso(value) || undefined;
}

function stampTitle(value) {
  const stamp = formatStamp(value);
  if (!stamp || isDayOnly(value)) return stamp;
  const theirs = readerTime(value);
  return theirs ? `${stamp}\n${theirs} where you are` : stamp;
}
