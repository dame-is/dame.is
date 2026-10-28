import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDayShortLabel } from '../lib/time.js';
import { calendarDay, longDay, sectionHref, shortDay } from '../lib/ledger.js';
import { countPhrase, dayVerbCounts } from '../lib/homeFeed.js';
import { useNow } from '../hooks/useNow.js';
import './DayOfLifeHeader.css';

/**
 * What a day header says, in one format on every feed page: a name ("Today",
 * "Yesterday", else the weekday) and the date in small caps beside it
 * ("Tuesday, October 27" under Today, "October 25" under Sunday), the year
 * only when it isn't this one. `short` is the strip's compact form ("Today",
 * "Oct 25").
 *
 * Every part comes from time.js's own calendar (the day groupByDay files the
 * rows under): `date` is the day's newest record, and in the evening that
 * instant is already tomorrow in UTC, so a UTC-built label named the wrong day
 * for anyone west of Greenwich.
 */
export function dayHeaderLabels(date, now = new Date()) {
  const rel = formatDayShortLabel(date, now);
  const named = rel === 'Today' || rel === 'Yesterday';
  const long = longDay(date, now);
  const day = calendarDay(date);
  if (!day) return { name: rel, date: '', short: rel };
  return {
    name: named ? rel : day.weekday,
    // "Sunday, October 25" without its weekday when the weekday is the name.
    date: named ? long : long.slice(day.weekday.length + 2),
    short: named ? rel : shortDay(date, now),
  };
}

/**
 * What a day holds, as the counts its rows add up to ("posted 18 · reposted
 * 5"), each linking to its section. `link={false}` on a page that already is
 * the section.
 */
export function DayCounts({ items, link = true }) {
  const counts = dayVerbCounts(items);
  if (!counts.length) return null;
  return counts.map(({ verb, count }, i) => {
    const phrase = countPhrase(verb, count);
    const to = link ? sectionHref(verb) : null;
    return (
      <Fragment key={verb}>
        {i > 0 && ' · '}
        {to ? <Link to={to}>{phrase}</Link> : phrase}
      </Fragment>
    );
  });
}

/**
 * The head of a day in a feed: its name and date on the left; on the right
 * what the day holds (`meta`: the home ledger's counts, /listening's songs and
 * minutes) and the day-of-life folio that closes the line, like a running
 * head's page number. `variant="ledger"` sets it on one ruled line (see
 * Feed.css); the cards layout stacks it.
 *
 * "Today" / "Yesterday" are relative to a clock that keeps running (useNow),
 * so a page left open past midnight moves them along. The chrome's strip reads
 * the day in view from `.day-section-header .day-header`; `data-day-short` is
 * its compact form, for a strip that wants one.
 */
export default function DayOfLifeHeader({
  date,
  meta = null,
  variant = 'default',
}) {
  const now = useNow();
  const day = dayOfLife(date);
  const { name, date: dateText, short } = dayHeaderLabels(date, now);
  return (
    <header className={`day-section-header day-section-header-${variant}`}>
      <h3 className="day-header" data-day-short={short}>
        <span className="day-header-name">{name}</span>
        {dateText && (
          <>
            {' '}
            <span className="day-header-date">{dateText}</span>
          </>
        )}
      </h3>
      <p className="day-header-meta">
        {meta && <span className="day-header-counts">{meta}</span>}
        <span className="day-header-folio">day {day.toLocaleString('en-US')}</span>
      </p>
    </header>
  );
}
