// Shell-shaped loading placeholder. Shown while the ATProto session is being
// restored — the one gate that reliably takes long enough to see — so the admin
// resolves into the same three columns it was already occupying, instead of
// growing a rail and a list column out of a single-column list skeleton.
//
// It lives here, not in src/components/Skeleton.jsx, because Skeleton.jsx is in
// the EAGER public bundle: App.jsx statically imports EditSheet, which imports
// RecordEditor, which imports Skeleton.jsx. The admin is carefully lazy. Putting
// an admin-only component and an admin-only CSS block there would ship them to
// every public visitor for no benefit.
//
// It DOES import from Skeleton.jsx — the editor and record-list skeletons are
// already written and already in that eager bundle, so reusing them is free and
// a second implementation would just drift from the real geometry.
//
// It reserves NO bar row. It used to draw one below 60rem, because the frame had
// a third row there; the phone admin now wears the site's bottom bar, which is
// outside the frame and already on screen behind this placeholder, so reserving
// 56px would make the skeleton stand a bar taller than the shell it resolves
// into — the exact step the reservation existed to prevent.

import { Skeleton, AdminEditorSkeleton, AdminRecordListSkeleton } from '../components/Skeleton.jsx';
import './adminShell.css';

/**
 * @param {object} props
 * @param {number} [props.rails]  How many rail chips to draw. The real rail has
 *                                about twenty, but the count is cosmetic here.
 * @param {number} [props.rows]   List rows.
 */
export default function WorkbenchSkeleton({ rails = 12, rows = 7 }) {
  return (
    <div className="wb wb-skel">
      <div className="wb-shell">
        <div className="wb-rail wb-skel-rail" aria-hidden="true">
          {Array.from({ length: rails }, (_, i) => (
            <Skeleton key={i} className="wb-skel-chip" />
          ))}
        </div>
        <div className="wb-pane wb-pane-list">
          {/* The `workbench` variant, because this column resolves into
              RecordListPane's two-line `.wb-list-row`s, not the classic
              rkey-leading `.admin-record-row`. */}
          <AdminRecordListSkeleton rows={rows} variant="workbench" label="Restoring session" />
        </div>
        <div className="wb-pane wb-pane-detail">
          <AdminEditorSkeleton />
        </div>
      </div>
    </div>
  );
}
