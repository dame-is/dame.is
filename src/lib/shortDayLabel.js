// The day in view, short enough to ride beside the bottom bar's ↑ chip.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A day header's words, short: "today", "yesterday", "Oct 25", or
 * "Oct 25, 2024" for another year. The feeds' day headers say "Today,
 * October 28, 2026" or "October 25, 2026" (time.js formatDayLabel /
 * formatDayShortLabel), and a date with something before it ("1 week ago,
 * October 21, 2026") still comes out as the date. Anything else (a night on
 * /mothing, "Daytime & untimed") is kept as written.
 */
export function shortDayLabel(text, now = new Date()) {
  const s = String(text || '').trim();
  if (!s) return '';
  const rel = /^(today|yesterday)\b/i.exec(s);
  if (rel) return rel[1].toLowerCase();
  const m = /\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS_LONG.indexOf(m[1]);
    if (month >= 0) {
      const short = `${MONTHS_SHORT[month]} ${m[2]}`;
      return Number(m[3]) === now.getFullYear() ? short : `${short}, ${m[3]}`;
    }
  }
  return s;
}
