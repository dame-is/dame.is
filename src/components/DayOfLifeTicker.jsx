import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';
import TickerText from './TickerText.jsx';

export default function DayOfLifeTicker() {
  const { day, dayOfYear, year } = useLiveDayOfLife();
  const tooltip = `Day ${day} · ${dayOfYear} of 365 · Year ${year}`;
  return (
    <span className="chrome-signal chrome-signal-day">
      <span className="chrome-signal-label">day of life</span>
      <TickerText className="chrome-signal-value" title={tooltip}>
        <strong>{day.toLocaleString()}</strong>
      </TickerText>
    </span>
  );
}
