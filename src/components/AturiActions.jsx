import { aturiUniversalUrl, aturiExplorerUrl } from '../lib/atproto.js';

/**
 * Small row of links under a record that hand off to aturi.to:
 *   - "Open in…"     → the universal-link landing page (pick any client)
 *   - "Inspect Data" → the Atmosphere Explorer raw-record view
 *
 * Renders nothing when the URI can't be parsed.
 */
export default function AturiActions({ atUri }) {
  const openUrl = aturiUniversalUrl(atUri);
  const inspectUrl = aturiExplorerUrl(atUri);
  if (!openUrl && !inspectUrl) return null;
  return (
    <div className="record-aturi-actions">
      {openUrl && (
        <a href={openUrl} target="_blank" rel="noreferrer noopener">
          Open in…
        </a>
      )}
      {inspectUrl && (
        <a href={inspectUrl} target="_blank" rel="noreferrer noopener">
          Inspect Data
        </a>
      )}
    </div>
  );
}
