// The one place the workbench says what is unsaved and offers Save / Delete.
//
// It replaces the old arrangement where the admin editor published its controls
// into the site-wide bottom `EditModeBar` through `setPageEditor` — a bar that
// belongs to the public quick-edit sheet and had to be taught to serve two
// masters. Here the controls sit on the pane they act on.
//
// It is the FIRST CHILD of `.wb-pane-detail`, never a grid sibling of the panes,
// and on DESKTOP it pins to the top of that scrollport.
//
// **It renders nothing below 60rem.** The phone's status and its Save live in
// `AdminActionBar`, which is a row of the fixed frame rather than a sticky box
// inside a scrollport — see docs/admin-mobile-design.md §2.1. Being sticky is
// what put this strip 64px above the bottom of the frame with live form fields
// scrolling through the gap underneath it, and no amount of offset arithmetic
// fixes a box that is clamped to its containing block. The BAR renders this
// file's `StatusMessage` with this file's classes, so the dirty sentence is
// defined exactly once.
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
 * The sentence, in priority order: a save failure, then an explicit note, then
 * named fields, then the bare fact. Field labels are truncated at three because
 * the strip is one line on a phone and a nine-field list would push the buttons
 * off screen.
 *
 * Exported because the action bar's centre slot says the same thing in the same
 * words; two implementations would drift the moment one of them gained a state.
 *
 * @param {import('./useAdminShell.jsx').DirtyState} dirty
 * @param {import('./useAdminShell.jsx').PaneActions|null} [actions]
 * @returns {string}
 */
export function dirtySentence(dirty, actions = null) {
  if (dirty.error) return `Not saved — ${dirty.error}`;
  if (dirty.dirty) {
    if (dirty.note) return dirty.note;
    const fields = dirty.fields || [];
    if (fields.length > 0) {
      const shown = fields.slice(0, 3).join(', ');
      const rest = fields.length > 3 ? `, +${fields.length - 3} more` : '';
      return `${fields.length} field${fields.length === 1 ? '' : 's'} changed: ${shown}${rest}`;
    }
    return 'Unsaved changes';
  }
  // Three idle states, not one. "No unsaved changes" was being asserted about a
  // record the editor had not finished loading, and about a record that does not
  // exist yet — where "unsaved changes" is not the axis at all, which is why the
  // button beside it already said CREATE rather than SAVE.
  if (actions?.loading) return 'Loading…';
  if (actions?.isNew) return 'Not created yet';
  return 'No unsaved changes';
}

/**
 * The sentence with its hairline square and the shared-records note — the strip's
 * whole left half, so the bar can render it verbatim.
 *
 * @param {object} props
 * @param {import('./useAdminShell.jsx').DirtyState} props.dirty
 * @param {import('./useAdminShell.jsx').PaneActions|null} [props.actions]
 */
export function StatusMessage({ dirty, actions = null }) {
  const records = dirty.records || 0;
  return (
    <p className="wb-strip-state">
      <span className="wb-strip-dot" aria-hidden="true" />
      <span className="wb-strip-message">{dirtySentence(dirty, actions)}</span>
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
  );
}

/**
 * Renders null when stacked (the bar has it), and when there is nothing unsaved
 * AND no pane has registered actions.
 */
export default function AdminStatusStrip() {
  const { dirty, actions, stacked } = useAdminShell();
  if (stacked) return null;
  if (!dirty.dirty && !dirty.error && !actions) return null;

  const busy = !!actions && (actions.saving || actions.deleting || actions.loading);

  return (
    <div
      className="wb-strip"
      data-dirty={dirty.dirty ? '' : undefined}
      data-error={dirty.error ? '' : undefined}
    >
      <StatusMessage dirty={dirty} actions={actions} />

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
