import { Link } from 'react-router-dom';
import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';
import TickerText from './TickerText.jsx';
import { xrayNotARecord } from '../lib/xray.js';

export default function DayOfLifeTicker() {
  const { day, dayOfYear, year, yearLength } = useLiveDayOfLife();
  const tooltip = `Day ${day.toLocaleString()} of their life · ${dayOfYear} of ${yearLength} · Year ${year}`;
  return (
    <span className="chrome-signal chrome-signal-day" {...xrayNotARecord('computed')}>
      {/* Reads as one small-caps phrase — "on day 12,124" — with only the
          number carrying the bold value ink. The inline-flex gap gives the
          number the same breathing room as the label↔value gap on every other
          chrome row (.chrome-signal's 0.45em), rather than a tighter plain
          word-space. It was "on day 12,124 of their life", but at a laptop's
          width that tail pushed the phrase onto a line of its own under the
          vitals; whose life it is, the tooltip and the link still say. */}
      <TickerText className="chrome-signal-value" title={tooltip}>
        {/* Whose life: the day leads to /themself, the page about Dame. */}
        <Link
          to="/themself"
          className="chrome-signal-link chrome-signal-day-phrase"
          aria-label={`On day ${day.toLocaleString()} of their life`}
        >
          <span className="chrome-signal-label">on day</span>
          <strong>{day.toLocaleString()}</strong>
        </Link>
      </TickerText>
    </span>
  );
}
