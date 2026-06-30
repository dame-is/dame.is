import { useAtUri } from '../hooks/useAtUri.js';
import { relativeTime } from '../lib/time.js';

/**
 * Reads `createdAt` / `updatedAt` from the current route's backing record
 * and renders a relative-time pair: "written 2w ago · updated 3d ago".
 *
 * Replaces the old GitHub `last-commit` footer — freshness now comes from
 * the PDS record backing the page, not from git.
 */
export default function RecordTimestamp() {
  const { record } = useAtUri();
  const value = record?.value || record;
  // Different lexicons name their primary timestamp differently —
  // site.standard.document / leaflet use `publishedAt`, teal.fm uses
  // `playedTime`. Mirror the feed-item resolution so the footer populates
  // for every record type, not just is.dame.* (which carry `createdAt`).
  const createdAt =
    value?.createdAt || value?.publishedAt || value?.playedTime || record?.indexedAt;
  const updatedAt = value?.updatedAt || createdAt;

  if (!createdAt) {
    return <span className="record-timestamp gutter">written &mdash; · updated &mdash;</span>;
  }

  const written = relativeTime(createdAt);
  const updated = relativeTime(updatedAt);
  const same = written === updated;

  return (
    <span
      className="record-timestamp gutter"
      title={`createdAt: ${createdAt}\nupdatedAt: ${updatedAt}`}
    >
      written {written}
      {!same && <> · updated {updated}</>}
    </span>
  );
}
