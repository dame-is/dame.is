import { ExternalLink, Microscope } from 'lucide-react';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import { useXray } from '../hooks/useXray.jsx';

/**
 * One row of quiet actions under a record:
 *   - "Open in…"       → the in-site waypoints picker (choose any client),
 *                         powered by @aturi.to/waypoints.
 *   - "Inspect record" → switches x-ray on for this page, as the microscope
 *                         in the bottom bar does, so the record's tree opens
 *                         beside it. (It used to be a boxed "Inspect Data"
 *                         link away to /exploring; the explorer is one tap
 *                         from x-ray's own panel.)
 * `children` join the same row, e.g. a play's Apple Music and Spotify links,
 * so a page never stacks a second button style above this one.
 *
 * The row is the kit's text buttons (controls.css .btn--text), the small size,
 * so a play's links and these read as one line of quiet actions.
 *
 * Renders nothing when the URI isn't an at:// URI.
 */
export default function AturiActions({ atUri, children }) {
  const { active, enter } = useXray();
  const canOpen = typeof atUri === 'string' && atUri.startsWith('at://');
  if (!canOpen) return null;
  return (
    <div className="record-aturi-actions">
      {children}
      <OpenInButton atUri={atUri} />
      <button
        type="button"
        className={`btn btn--text btn--sm${active ? ' is-on' : ''}`}
        onClick={enter}
        aria-pressed={active}
      >
        <Microscope size={13} strokeWidth={1.75} aria-hidden="true" />
        Inspect record
      </button>
    </div>
  );
}

/**
 * "Open in…" alone, for a page that sets it somewhere other than this row: a
 * post's page puts it at the right of its Replies heading. Nothing when the
 * URI isn't an at:// URI.
 */
export function OpenInButton({ atUri }) {
  const { openWaypoints } = useWaypointsModal();
  if (typeof atUri !== 'string' || !atUri.startsWith('at://')) return null;
  return (
    <button type="button" className="btn btn--text btn--sm" onClick={() => openWaypoints(atUri)}>
      <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
      Open in…
    </button>
  );
}
