import { useLocation } from 'react-router-dom';
import { useAtUri } from '../hooks/useAtUri.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedFooter } from '../hooks/useFeedFooter.jsx';
import { relativeTime } from '../lib/time.js';

/**
 * Reads `createdAt` / `updatedAt` from the current route's backing record
 * and renders a relative-time pair: "written 2w ago · updated 3d ago".
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
  if (latestRecordAt) {
    return (
      <span className="record-timestamp small-caps" title={`latest record: ${latestRecordAt}`}>
        latest record {relativeTime(latestRecordAt)}
      </span>
    );
  }
  return <RouteRecordTimestamp />;
}

function RouteRecordTimestamp() {
  const location = useLocation();
  const { pageRecord } = useEditMode();
  // Prefer the record the page registered via PageShell over pure route
  // derivation — routes whose backing record is picked dynamically
  // (/for-hire's active is.dame.resume) can't be derived from the URL
  // alone. Path-guarded so a stale registration from the previous page
  // never leaks in mid-navigation.
  const registered =
    pageRecord?.atUri && pageRecord.path === location.pathname
      ? { atUri: pageRecord.atUri, cid: pageRecord.cid }
      : undefined;
  const { record } = useAtUri(registered);
  const value = record?.value || record;
  // Different lexicons name their primary timestamp differently —
  // site.standard.document / leaflet use `publishedAt`, teal.fm uses
  // `playedTime`. Mirror the feed-item resolution so the footer populates
  // for every record type, not just is.dame.* (which carry `createdAt`).
  const createdAt =
    value?.createdAt || value?.publishedAt || value?.playedTime || record?.indexedAt;
  const updatedAt = value?.updatedAt || createdAt;

  if (!createdAt) {
    return <span className="record-timestamp small-caps">written &mdash; · updated &mdash;</span>;
  }

  const written = relativeTime(createdAt);
  const updated = relativeTime(updatedAt);
  const same = written === updated;

  return (
    <span
      className="record-timestamp small-caps"
      title={`createdAt: ${createdAt}\nupdatedAt: ${updatedAt}`}
    >
      written {written}
      {!same && <> · updated {updated}</>}
    </span>
  );
}
