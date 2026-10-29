import { useLocation } from 'react-router-dom';
import { useAtUri } from '../hooks/useAtUri.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedFooter } from '../hooks/useFeedFooter.jsx';
import { relativeTime } from '../lib/time.js';
import { useNow } from '../hooks/useNow.js';
import Time from './Time.jsx';

/**
 * Reads `createdAt` / `updatedAt` from the current route's backing record
 * and renders a relative-time pair: "written 2w ago · updated 3d ago" — or,
 * past 30 days, the date: "written Jan 29, 2025".
 *
 * Replaces the old GitHub `last-commit` footer — freshness now comes from
 * the PDS record backing the page, not from git.
 *
 * Feed pages have no single backing record, so they instead publish the
 * newest visible record's instant via useFeedFooter; when that's present it
 * wins and the footer reports "latest record …" rather than an empty pair.
 */
export default function RecordTimestamp() {
  const { latestRecordAt } = useFeedFooter();
  // The shared minute clock keeps "latest record 2m ago" true on a page left
  // open; the footer has no other reason to re-render while the feed is quiet.
  const now = useNow();
  if (latestRecordAt) {
    return (
      <span className="record-timestamp small-caps" title={`latest record: ${latestRecordAt}`}>
        latest record <Time className="unit" value={latestRecordAt} variant="relative" title={null} />
      </span>
    );
  }
  return <RouteRecordTimestamp now={now} />;
}

function RouteRecordTimestamp({ now }) {
  const location = useLocation();
  const { pageRecord } = useEditMode();
  // Prefer the record the page registered via PageShell over pure route
  // derivation — routes whose backing record is picked dynamically
  // (/available's active is.dame.resume) can't be derived from the URL
  // alone. Path-guarded so a stale registration from the previous page
  // never leaks in mid-navigation.
  const registered =
    pageRecord?.atUri && pageRecord.path === location.pathname
      ? { atUri: pageRecord.atUri, cid: pageRecord.cid }
      : undefined;
  const { record, recordStatus } = useAtUri(registered);
  const value = record?.value || record;
  // Different lexicons name their primary timestamp differently —
  // site.standard.document / leaflet use `publishedAt`, teal.fm uses
  // `playedTime`. Mirror the feed-item resolution so the footer populates
  // for every record type, not just is.dame.* (which carry `createdAt`).
  const createdAt =
    value?.createdAt || value?.publishedAt || value?.playedTime || record?.indexedAt;
  const updatedAt = value?.updatedAt || createdAt;

  if (!createdAt) {
    // The dashes are a placeholder for an answer on its way, so they only show
    // while one is. A route with no record behind it (a 404, /themself with no
    // profile record, an album or a night) or a record that never turned up has
    // nothing to fill them with, and left them standing for good. The empty
    // span still holds the footer's left slot, so "Published on the AT
    // Protocol" stays on the right.
    if (recordStatus !== 'loading' && recordStatus !== 'idle') {
      return <span className="record-timestamp small-caps" />;
    }
    return <span className="record-timestamp small-caps">written &mdash; · updated &mdash;</span>;
  }

  const written = relativeTime(createdAt, now);
  const updated = relativeTime(updatedAt, now);
  const same = written === updated;

  return (
    <span
      className="record-timestamp small-caps"
      title={`createdAt: ${createdAt}\nupdatedAt: ${updatedAt}`}
    >
      {/* The times keep their case inside the capitals (typography.css .unit):
          "1mo" set as "1MO" read as "IMO". */}
      written <Time className="unit" value={createdAt} variant="relative" title={null} />
      {!same && (
        <>
          {' '}
          · updated <Time className="unit" value={updatedAt} variant="relative" title={null} />
        </>
      )}
    </span>
  );
}
