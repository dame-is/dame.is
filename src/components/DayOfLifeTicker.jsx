import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';

export default function DayOfLifeTicker() {
  const { day, dayOfYear, year } = useLiveDayOfLife();
  return (
    <span
      className="chrome-signal chrome-signal-day"
      title={`Day ${day} · ${dayOfYear} of 365 · Year ${year}`}
    >
      <span className="chrome-signal-label">day</span>
      <span className="chrome-signal-value">
        <strong>{day.toLocaleString()}</strong>
        <span> · {dayOfYear}/365 · y{year}</span>
      </span>
    </span>
  );
}
