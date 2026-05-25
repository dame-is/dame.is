import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDateLong, relativeDay } from '../lib/time.js';
import './DayOfLifeHeader.css';

export default function DayOfLifeHeader({ date, prefix = null, meta = null }) {
  const day = dayOfLife(date);
  const absolute = formatDateLong(date);
  const relative = relativeDay(date);
  return (
    <header className="day-section-header">
      <h3 className="day-header">
        {prefix ? (
          <span className="day-header-prefix">{prefix}</span>
        ) : (
          <span className="day-header-num">Day {day.toLocaleString()}</span>
        )}
        <span className="day-header-rule" aria-hidden="true" />
        <span
          className="day-header-date"
          title={absolute}
          aria-label={`${relative} (${absolute})`}
        >
          {relative}
        </span>
      </h3>
      {meta && <p className="day-header-meta">{meta}</p>}
    </header>
  );
}
