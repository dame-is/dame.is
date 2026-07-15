import { Link } from 'react-router-dom';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';

/**
 * Small row of actions under a record:
 *   - "Open in…"     → opens the in-site waypoints picker (choose any client),
 *                       powered by @aturi.to/waypoints.
 *   - "Inspect Data" → the record in this site's OWN Atmosphere Explorer
 *                       (/exploring). It used to deep-link out to aturi.to's
 *                       explorer; now that the site has its own exploring
 *                       feature (and inspect mode), it stays in-house.
 *
 * Renders nothing when the URI can't be turned into either action.
 */
export default function AturiActions({ atUri }) {
  const { openWaypoints } = useWaypointsModal();
  const explorePath = explorerPathFromAtUri(atUri);
  const canOpen = typeof atUri === 'string' && atUri.startsWith('at://');
  if (!canOpen && !explorePath) return null;
  return (
    <div className="record-aturi-actions">
      {canOpen && (
        <button type="button" onClick={() => openWaypoints(atUri)}>
          Open in…
        </button>
      )}
      {explorePath && <Link to={explorePath}>Inspect Data</Link>}
    </div>
  );
}
