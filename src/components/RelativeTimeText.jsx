import Time from './Time.jsx';

/**
 * A feed row's relative time: `<Time variant="relative" compact>`, kept under
 * its old name for the rows that import it. The trailing " ago" sits in a
 * `.time-ago-suffix` span that CSS hides on narrow viewports, so a timestamp
 * reads "33m" on a phone and "33m ago" on a wider screen. Past 30 days it's
 * the date instead, and it keeps counting on a page left open (useNow).
 */
export default function RelativeTimeText({ value }) {
  return <Time value={value} variant="relative" compact />;
}
