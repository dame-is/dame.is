import { aturiExplorerUrl } from '../lib/atproto.js';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';

/**
 * Small row of actions under a record:
 *   - "Open in…"     → opens the in-site waypoints picker (choose any client),
 *                       powered by @aturi.to/waypoints.
 *   - "Inspect Data" → the Atmosphere Explorer raw-record view on aturi.to.
 *
 * Renders nothing when the URI can't be turned into either action.
 */
export default function AturiActions({ atUri }) {
  const { openWaypoints } = useWaypointsModal();
  const inspectUrl = aturiExplorerUrl(atUri);
  const canOpen = typeof atUri === 'string' && atUri.startsWith('at://');
  if (!canOpen && !inspectUrl) return null;
  return (
    <div className="record-aturi-actions">
      {canOpen && (
        <button type="button" onClick={() => openWaypoints(atUri)}>
          Open in…
        </button>
      )}
      {inspectUrl && (
        <a href={inspectUrl} target="_blank" rel="noreferrer noopener" data-no-waypoints>
          Inspect Data
        </a>
      )}
    </div>
  );
}
