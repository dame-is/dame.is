import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDateLong, formatDayLabel, relativeDay } from '../lib/time.js';
import './DayOfLifeHeader.css';

export default function DayOfLifeHeader({ date, meta = null }) {
  const day = dayOfLife(date);
  const absolute = formatDateLong(date);
  const relative = relativeDay(date);
  const label = formatDayLabel(date);
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
