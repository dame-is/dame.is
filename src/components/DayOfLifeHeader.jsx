import { dayOfLife } from '../lib/dayOfLife.js';
import { formatDateLong } from '../lib/time.js';
import './DayOfLifeHeader.css';

export default function DayOfLifeHeader({ date }) {
  const day = dayOfLife(date);
  return (
    <h3 className="day-header">
      <span className="day-header-num">Day {day.toLocaleString()}</span>
      <span className="day-header-rule" aria-hidden="true" />
      <span className="day-header-date">{formatDateLong(date)}</span>
    </h3>
  );
}
