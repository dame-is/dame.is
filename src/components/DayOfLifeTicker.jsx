import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';
import TickerText from './TickerText.jsx';

export default function DayOfLifeTicker() {
  const { day, dayOfYear, year } = useLiveDayOfLife();
  const tooltip = `Day ${day} · ${dayOfYear} of 365 · Year ${year}`;
  return (
    <span className="chrome-signal chrome-signal-day">
      {/* Reads as one small-caps phrase — "on day 12,124 of their life" — with
          only the number carrying the bold value ink. The inline-flex gap gives
          the number the same breathing room on both sides as the label↔value
          gap on every other chrome row (.chrome-signal's 0.45em), rather than a
          tighter plain word-space. */}
      <TickerText className="chrome-signal-value" title={tooltip}>
        <span className="chrome-signal-day-phrase">
          <span className="chrome-signal-label">on day</span>
          <strong>{day.toLocaleString()}</strong>
          <span className="chrome-signal-label">of their life</span>
        </span>
      </TickerText>
    </span>
  );
}
