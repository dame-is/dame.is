// The one place the workbench says what is unsaved and offers Save / Delete.
//
// It replaces the old arrangement where the admin editor published its controls
// into the site-wide bottom `EditModeBar` through `setPageEditor` — a bar that
// belongs to the public quick-edit sheet and had to be taught to serve two
// masters. Here the controls sit on the pane they act on.
//
// It is the FIRST CHILD of `.wb-pane-detail`, never a grid sibling of the panes.
// That single fact is what lets one element be top-sticky on desktop and
// bottom-sticky when stacked: a first-child sticky box with only `bottom` set
// floats down to the scrollport bottom and pins there until the pane's own
// bottom edge scrolls past it. A sibling of the pane could do neither.
//
// **Save is a plain `<button type="button" onClick>` rendered outside
// `.blocks-editor`, and must stay that way.** BlocksEditor's outside-press
// dismisser runs on capture-phase `click` with a `flushSync`, so a markdown
// block is resolved to real blocks BEFORE this handler reads the value. Wiring
// Save to `pointerdown`/`touchstart`, or nesting it inside the editor's root,
// reintroduces the swallowed-first-tap bug and can save unresolved markdown
// source.

import { Save, Trash2 } from 'lucide-react';
import { useAdminShell } from './useAdminShell.jsx';

/**
 * The sentence, in priority order: an explicit note, then named fields, then the
 * bare fact. Field labels are truncated at three because the strip is one line
 * on a phone and a nine-field list would push the buttons off screen.
 */
function dirtySentence(dirty) {
  if (dirty.note) return dirty.note;
  const fields = dirty.fields || [];
  if (fields.length > 0) {
    const shown = fields.slice(0, 3).join(', ');
    const rest = fields.length > 3 ? `, +${fields.length - 3} more` : '';
    return `${fields.length} field${fields.length === 1 ? '' : 's'} changed: ${shown}${rest}`;
  }
  return 'Unsaved changes';
}

/** Renders null when there is nothing unsaved AND no pane has registered actions. */
export default function AdminStatusStrip() {
  const { dirty, actions } = useAdminShell();
  if (!dirty.dirty && !actions) return null;

  const busy = !!actions && (actions.saving || actions.deleting || actions.loading);
  const records = dirty.records || 0;
  const message = dirty.dirty ? dirtySentence(dirty) : 'No unsaved changes';

  return (
    <div className="wb-strip" data-dirty={dirty.dirty ? '' : undefined}>
      <p className="wb-strip-state">
        <span className="wb-strip-dot" aria-hidden="true" />
        <span className="wb-strip-message">{message}</span>
        {records > 0 && (
          // Matches the resume workbench's own wording — that studio stages
          // edits to sibling records, and the count is the only warning that
          // saving will write more than the record on screen.
          <span className="wb-strip-shared">
            {' '}
            · {records} shared record{records === 1 ? '' : 's'}
          </span>
        )}
      </p>

      {actions && (
        <div className="wb-strip-actions">
          {actions.canDelete && (
            <button
              type="button"
              className="admin-gate-button admin-gate-button-tight admin-danger"
              onClick={() => actions.remove?.()}
              disabled={busy}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>{actions.deleting ? 'Deleting…' : 'Delete'}</span>
            </button>
          )}
          <button
            type="button"
            className="admin-gate-button admin-gate-button-tight"
            onClick={() => actions.save?.()}
            disabled={busy}
          >
            <Save size={15} aria-hidden="true" />
            <span>
              {actions.saving
                ? actions.isNew
                  ? 'Creating…'
                  : 'Saving…'
                : actions.isNew
                  ? 'Create'
                  : 'Save'}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
