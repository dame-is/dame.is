import { relativeTime } from '../lib/time.js';

/**
 * Renders a relative-time string with the trailing " ago" wrapped in
 * a `.time-ago-suffix` span. CSS hides that span on narrow viewports
 * so feed-item timestamps read "33m" on mobile but "33m ago" on
 * wider screens — the "ago" is implicit when space is tight.
 */
export default function RelativeTimeText({ value }) {
  const text = relativeTime(value);
  if (!text) return null;
  const m = text.match(/^(.+) ago$/);
  if (!m) return text;
  return (
    <>
      {m[1]}
      <span className="time-ago-suffix"> ago</span>
    </>
  );
}
