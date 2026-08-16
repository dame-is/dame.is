// The phone admin's chrome: a three-slot bar that is the THIRD ROW OF THE FIXED
// FRAME, below the pane, and never a sticky box inside a scrollport.
//
// That one structural decision retires a class of defect rather than an
// instance of one. A sticky box is clamped to its containing block, which is
// why the status strip floated exactly 64px (the pane's own padding-bottom)
// above the frame edge with live form fields scrolling through the gap under
// it, and why the sky studio's hour bar floated 56px up clearing a ChromeBar
// this route does not render. A frame row cannot float, cannot be clamped,
// needs no `env()` arithmetic against furniture that is not there, and needs no
// `scroll-padding-bottom` — the scrollport now ENDS where the bar begins, so no
// focused field can land underneath it.
//
// Three slots, and what goes in each is a rule, not a preference
// (docs/admin-mobile-design.md §2.1):
//
//   left    always OUTWARD   — the Surfaces sheet, or back out of a record
//   centre  always STATUS    — the dirty sentence, a count, a studio's state
//   right   always the surface's PRIMARY action, plus `⋯` for everything that
//                             is destructive or rare
//
// A pane says what it wants through `registerBar` (see the BarSlots typedef in
// useAdminShell.jsx). Every slot has a shell DEFAULT, which is deliberate: a
// pane that has not been taught about the bar yet still gets working
// navigation, a truthful status line, and its Save — because the default right
// slot is built from `registerActions`, the channel every editing surface
// already publishes on.
//
// Delete is NOT a slot. It lives in the `⋯` menu behind a named confirm,
// because at 32px tall and 8px from Save it was a mis-tap away from destroying
// a record on a live PDS with no undo anywhere in the data layer.

import { useMemo } from 'react';
import { ChevronLeft, ChevronUp, Ellipsis } from 'lucide-react';
import AdminSheet from './AdminSheet.jsx';
import AdminSurfaceSheet from './AdminSurfaceSheet.jsx';
import { StatusMessage } from './AdminStatusStrip.jsx';
import { SurfaceIcon } from './AdminRail.jsx';
import { useAdminShell } from './useAdminShell.jsx';
import './adminBar.css';

/** The sheet ids this component owns. Panes name their own; these two are ours. */
const SURFACES_SHEET = 'surfaces';
const OVERFLOW_SHEET = 'overflow';

/**
 * Run a bar action, asking its confirm question first when it has one. Confirms
 * live on the ACTION rather than in the bar so a pane can word its own — "Delete
 * *On keeping a website like a garden*? This cannot be undone." names the record,
 * which `window.confirm` inside a generic bar never could.
 */
function press(action, after) {
  if (!action || action.disabled || action.busy) return;
  if (action.confirm && !window.confirm(action.confirm)) return;
  after?.();
  action.onPress?.();
}

/**
 * One control in slot 1 or slot 3. `tone` decides the paint; the 44px floor is
 * the class's, not the caller's.
 *
 * @param {{action: import('./useAdminShell.jsx').BarAction, tone?: string,
 *          onRun?: () => void}} props
 */
function BarButton({ action, tone, onRun }) {
  const busy = action.busy === true;
  const label = busy ? action.busyLabel || action.label : action.label;
  return (
    <button
      type="button"
      className="wb-bar-btn"
      data-tone={tone || action.tone || 'quiet'}
      disabled={action.disabled === true || busy}
      aria-busy={busy ? 'true' : undefined}
      aria-label={action.ariaLabel || undefined}
      onClick={() => press(action, onRun)}
    >
      {action.icon && <SurfaceIcon name={action.icon} size={17} />}
      <span className="wb-bar-btn-label">{label}</span>
    </button>
  );
}

/**
 * The bar. Rendered by AdminShell only when `stacked`, so it never has to ask
 * about the breakpoint itself.
 */
export default function AdminActionBar() {
  const {
    surface,
    column,
    go,
    actions,
    dirty,
    barSlots,
    sheet,
    setSheet,
    rkey,
    isNew,
  } = useAdminShell();

  const slots = barSlots || {};
  // A record is open when the URL says so — `column` is derived from the URL and
  // only from the URL, which is the single reason the on-screen back and the
  // browser back cannot desync.
  const onRecord = column === 'detail' && surface.kind === 'records-list' && (rkey || isNew);

  /* --- slot 1: outward --------------------------------------------------- */

  const left = slots.left;

  /* --- slot 3: the primary action ---------------------------------------- */

  // Default from `registerActions`: Save (or Create), never Delete. `loading`
  // disables rather than hides, so the button does not appear late and move the
  // two beside it.
  const defaultActions = useMemo(() => {
    if (!actions?.save) return [];
    const saving = actions.saving === true;
    return [
      {
        id: 'save',
        label: actions.isNew ? 'Create' : 'Save',
        busy: saving,
        busyLabel: actions.isNew ? 'Creating…' : 'Saving…',
        disabled: actions.deleting === true || actions.loading === true,
        tone: 'primary',
        onPress: () => actions.save?.(),
      },
    ];
  }, [actions]);

  const rightActions = slots.actions === undefined ? defaultActions : slots.actions || [];

  /* --- the ⋯ menu -------------------------------------------------------- */

  // The shell contributes exactly one item, and only when the pane says the
  // record can be deleted. A pane that wants to name the record in its confirm
  // supplies its own `{ id: 'delete' }` and this one steps aside.
  const overflow = useMemo(() => {
    const own = slots.overflow || [];
    if (!actions?.canDelete || own.some((item) => item.id === 'delete')) return own;
    return [
      ...own,
      {
        id: 'delete',
        label: actions.deleting ? 'Deleting…' : 'Delete record…',
        icon: 'Archive',
        tone: 'danger',
        disabled: actions.deleting === true || actions.saving === true,
        confirm: 'Delete this record? This cannot be undone.',
        onPress: () => actions.remove?.(),
      },
    ];
  }, [slots.overflow, actions]);

  /* --- slot 2: status ---------------------------------------------------- */

  // `undefined` means "the shell decides"; `null` means "say nothing". The shell's
  // decision is the record's own dirty sentence, rendered from AdminStatusStrip's
  // component with the strip's classes so there is one sentence in the codebase.
  const showDefaultStatus =
    slots.status === undefined && (!!actions || dirty.dirty || !!dirty.error);

  return (
    <>
      <div className="wb-bar" data-error={dirty.error ? '' : undefined}>
        <div className="wb-bar-slot wb-bar-slot-left">
          {left === undefined ? (
            onRecord ? (
              // An explicit accessible name on both, because slot 1's label is
              // the one on the bar allowed to clip: it is `flex: 0 1 auto` over
              // `min-width: 0`, so on a narrow screen with a long surface name
              // it ellipses (§3.5's "slot 1 shrinks toward icon + caret"). A
              // name read from clipped text is a name with a piece missing.
              // Both strings CONTAIN the visible words, so voice control still
              // addresses the control by what is on screen.
              <button
                type="button"
                className="wb-bar-btn wb-bar-back"
                data-tone="quiet"
                aria-label={`Back to ${surface.label}`}
                onClick={() => go({ r: null, mode: null })}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span className="wb-bar-btn-label">{surface.shortLabel}</span>
              </button>
            ) : (
              <button
                type="button"
                className="wb-bar-btn wb-bar-surface"
                data-tone="quiet"
                aria-label={`${surface.label} — change surface`}
                aria-expanded={sheet === SURFACES_SHEET}
                aria-controls="wb-surfaces-sheet"
                onClick={() => setSheet(sheet === SURFACES_SHEET ? null : SURFACES_SHEET)}
              >
                <SurfaceIcon name={surface.icon} size={17} />
                <span className="wb-bar-btn-label">{surface.shortLabel}</span>
                <ChevronUp className="wb-bar-caret" size={14} aria-hidden="true" />
              </button>
            )
          ) : (
            left && <BarButton action={left} />
          )}
        </div>

        {/* aria-live so a count that changes under the owner's thumb — twenty
            more records loaded, three selected — is announced without moving
            focus. Fixed-width neighbours plus `min-width: 0` here is what stops
            the dirty sentence reflowing the bar per keystroke. */}
        <div className="wb-bar-slot wb-bar-slot-status" aria-live="polite">
          {showDefaultStatus ? (
            <StatusMessage dirty={dirty} actions={actions} />
          ) : (
            // `.wb-strip-message` around a pane's own status, not just around
            // the dirty sentence: it carries the ellipsis, and without it a
            // string long enough to fill the slot WRAPPED instead — measured on
            // listening at 390, where "100 loaded · more to fetch" took two
            // lines and pushed the bar's own controls apart. Slot 2 truncates;
            // it never grows the bar.
            slots.status && (
              <p className="wb-strip-state">
                <span className="wb-strip-message">{slots.status}</span>
              </p>
            )
          )}
        </div>

        <div className="wb-bar-slot wb-bar-slot-actions">
          {rightActions.slice(0, 2).map((action, index, all) => (
            <BarButton
              key={action.id}
              action={action}
              tone={action.tone || (index === all.length - 1 ? 'primary' : 'quiet')}
            />
          ))}
          {overflow.length > 0 && (
            <button
              type="button"
              className="wb-bar-btn wb-bar-more"
              data-tone="quiet"
              aria-label="More actions"
              aria-expanded={sheet === OVERFLOW_SHEET}
              aria-controls="wb-overflow-sheet"
              onClick={() => setSheet(sheet === OVERFLOW_SHEET ? null : OVERFLOW_SHEET)}
            >
              <Ellipsis size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <AdminSurfaceSheet
        id="wb-surfaces-sheet"
        open={sheet === SURFACES_SHEET}
        onClose={() => setSheet(null)}
      />

      <AdminSheet
        id="wb-overflow-sheet"
        label="More actions"
        open={sheet === OVERFLOW_SHEET}
        onClose={() => setSheet(null)}
      >
        <ul className="wb-sheet-list">
          {overflow.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                className="wb-sheet-row"
                data-tone={action.tone || 'quiet'}
                disabled={action.disabled === true || action.busy === true}
                onClick={() => press(action, () => setSheet(null))}
              >
                {action.icon && <SurfaceIcon name={action.icon} size={17} />}
                <span className="wb-sheet-row-label">{action.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </AdminSheet>
    </>
  );
}
