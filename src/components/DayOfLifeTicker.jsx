import { Link } from 'react-router-dom';
import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';
import TickerText from './TickerText.jsx';
import { xrayNotARecord } from '../lib/xray.js';

export default function DayOfLifeTicker() {
  const { day, dayOfYear, year, yearLength } = useLiveDayOfLife();
  const tooltip = `Day ${day.toLocaleString()} of their life · ${dayOfYear} of ${yearLength} · Year ${year}`;
  return (
    <span className="chrome-signal chrome-signal-day" {...xrayNotARecord('computed')}>
      {/* Reads as one small-caps phrase — "on day 12,124 of their life" —
          with only the number carrying the bold value ink. The inline-flex gap
          gives the number the same breathing room on both sides as the
          label↔value gap on every other chrome row (.chrome-signal's 0.45em),
          rather than a tighter plain word-space. "Of their life" shows only
          on a phone, where the day has a line of its own in the stacked
          atmosphere (ChromeBar.css); on a desk it shares the vitals row, and
          at a laptop's width the tail pushed it onto a line of its own there.
          The tooltip and the link's name say it either way. */}
      <TickerText className="chrome-signal-value" title={tooltip}>
        {/* Whose life: the day leads to /themself, the page about Dame. */}
        <Link
          to="/themself"
          className="chrome-signal-link chrome-signal-day-phrase"
          aria-label={`On day ${day.toLocaleString()} of their life`}
        >
          <span className="chrome-signal-label">on day</span>
          <strong>{day.toLocaleString()}</strong>
          <span className="chrome-signal-label chrome-signal-day-tail">of their life</span>
        </Link>
      </TickerText>
    </span>
  );
}
