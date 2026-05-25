import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDateLong, relativeDay } from '../lib/time.js';
import './DayOfLifeHeader.css';

export default function DayOfLifeHeader({ date, prefix = null }) {
  const day = dayOfLife(date);
  const absolute = formatDateLong(date);
  const relative = relativeDay(date);
  return (
    <h3 className="day-header">
      {prefix ? (
        <span className="day-header-prefix">{prefix}</span>
      ) : (
        <span className="day-header-num">Day {day.toLocaleString()}</span>
      )}
      <span className="day-header-rule" aria-hidden="true" />
      <span
        className="day-header-date"
        tabIndex={0}
        title={absolute}
        aria-label={`${relative} (${absolute})`}
      >
        <span className="day-header-date-relative" aria-hidden="true">{relative}</span>
        <span className="day-header-date-absolute" aria-hidden="true">{absolute}</span>
      </span>
    </h3>
  );
}
