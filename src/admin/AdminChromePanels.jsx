// The admin's half of the site's bottom chrome, below the stacked breakpoint.
//
// On a phone the admin stops drawing furniture of its own and wears ChromeBar
// (App.jsx withholds the site's chrome only at desk widths now). That leaves two
// jobs on this side of the seam:
//
//  1. PUBLISH what the bar cannot see — which surface is open, what its primary
//     action is, and what its state is — upward through AdminChromeProvider, so
//     ChromeBar can draw three buttons without importing one line of the admin.
//  2. RENDER the two panels those buttons open. The chrome cannot draw them: the
//     surface directory reads the surface registry, the counts cache and the
//     shell context, and importing any of that into ChromeBar would pull
//     @atproto/api into the eager bundle for every visitor who is not the owner.
//     So the buttons live up there and their panels live down here, joined by
//     the two panel names `admin-nav` / `admin-actions` that useChromePanel
//     already knows about — which also buys, for free, the site's own
//     one-panel-at-a-time rule against the sky sheet and the nav dock.
//
// The panels are `BottomSheet`s rather than `AdminSheet`s, which inverts the
// argument in AdminSheet.jsx's header: that component refuses BottomSheet
// because it is positioned entirely in terms of `--chrome-h`, `--chrome-top-h`
// and `--edit-bar-h`, none of which described /admin. At this width all three
// describe it exactly — the site's chrome IS the admin's chrome here — so the
// shared sheet is not merely usable, it is the only thing that lands on the
// right edge.
//
// `useBarModel` is exported for AdminActionBar, so the bar and the panels derive
// the same three slots, the same ⋯ menu and the same dirty sentence from one
// piece of code.

import { useEffect, useMemo, useRef } from 'react';
import BottomSheet from '../components/BottomSheet.jsx';
import {
  ADMIN_ACTIONS_PANEL,
  ADMIN_ACTIONS_PANEL_ID,
  ADMIN_NAV_PANEL,
  ADMIN_NAV_PANEL_ID,
  useAdminChrome,
} from '../hooks/useAdminChrome.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import AdminSurfaceSheet from './AdminSurfaceSheet.jsx';
import { dirtySentence, StatusMessage } from './AdminStatusStrip.jsx';
import { SurfaceIcon } from './AdminRail.jsx';
import { useAdminShell } from './useAdminShell.jsx';
import './adminBar.css';

/**
 * Run a bar action, asking its confirm question first when it has one. Confirms
 * live on the ACTION rather than in the chrome so a pane can word its own —
 * "Delete *On keeping a website like a garden*? This cannot be undone." names
 * the record, which a generic bar never could. It is also why the published
 * `run` is a plain function: the chrome must not have to know that an action can
 * refuse.
 */
export function press(action, after) {
  if (!action || action.disabled || action.busy) return;
  if (action.confirm && !window.confirm(action.confirm)) return;
  after?.();
  action.onPress?.();
}

/**
 * The three slots, the ⋯ menu and whether a record is open — everything both the
 * bar and the panels draw from.
 *
 * EVERY DERIVED VALUE IS MEMOIZED ON A STABLE INPUT, and that is a correctness
 * requirement rather than a performance note. The published payload is pushed
 * into a context that sits ABOVE the admin, so a payload whose identity changes
 * on every render would re-render the admin, rebuild the payload, and publish
 * again — forever. `barSlots` and `actions` are state, `dirty` is value-compared
 * by the shell and `surface` is a frozen module object, so as long as nothing
 * here builds an object outside a memo, the loop cannot start.
 */
export function useBarModel() {
  const { surface, column, go, actions, dirty, barSlots, rkey, isNew } = useAdminShell();

  const slots = barSlots || {};
  // A record is open when the URL says so — `column` is derived from the URL and
  // only from the URL, which is the single reason the on-screen back and the
  // browser back cannot desync.
  const onRecord = column === 'detail' && surface.kind === 'records-list' && (rkey || isNew);

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

  // The shell contributes exactly one ⋯ item, and only when the pane says the
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

  // `undefined` means "the shell decides"; `null` means "say nothing". The
  // shell's decision is the record's own dirty sentence.
  const showDefaultStatus =
    slots.status === undefined && (!!actions || dirty.dirty || !!dirty.error);

  return {
    surface,
    go,
    actions,
    dirty,
    slots,
    onRecord,
    rightActions,
    overflow,
    showDefaultStatus,
  };
}

/**
 * Slot 2's sentence, rendered from AdminStatusStrip's component with the strip's
 * classes so there is one dirty sentence in the codebase.
 *
 * `.wb-strip-message` wraps a pane's own status too, not just the dirty
 * sentence: it carries the ellipsis, and without it a string long enough to fill
 * the slot WRAPPED instead — measured on listening at 390, where "100 loaded ·
 * more to fetch" took two lines and pushed the bar's own controls apart.
 */
export function BarStatus({ model }) {
  const { showDefaultStatus, slots, dirty, actions } = model;
  if (showDefaultStatus) return <StatusMessage dirty={dirty} actions={actions} />;
  if (!slots.status) return null;
  return (
    <p className="wb-strip-state">
      <span className="wb-strip-message">{slots.status}</span>
    </p>
  );
}

/**
 * Publishes the surface upward and renders the two panels. Mounted by AdminShell
 * only when stacked, so nothing in here has to ask about the breakpoint.
 */
export default function AdminChromePanels() {
  const model = useBarModel();
  const { surface, go, dirty, slots, onRecord, rightActions, overflow, showDefaultStatus } =
    model;
  const { publish } = useAdminChrome();
  const { panel, closePanel } = useChromePanel();

  /* --- what the chrome draws as ONE button -------------------------------- */

  // The last non-destructive action is the primary. "Last" is the bar's own rule
  // (§2.1: slot 3 paints its final control as the primary); "non-destructive" is
  // the other half of it, stated where it can be enforced — the selection bar
  // ends on `Delete (3)`, and a Delete promoted to the one filled button under
  // the thumb is exactly the mis-tap this design retired.
  const primary = useMemo(() => {
    for (let i = rightActions.length - 1; i >= 0; i -= 1) {
      if (rightActions[i].tone !== 'danger') return rightActions[i];
    }
    return null;
  }, [rightActions]);

  // Everything else goes into the actions panel, in the order a thumb wants it:
  // the way OUT first (Cancel out of selection, or back to the list from a
  // record — the site's own back button walks history, which on a deep-linked
  // record leaves /admin altogether), then the remaining actions, then the ⋯
  // menu.
  const secondary = useMemo(() => {
    const out = [];
    if (slots.left !== undefined) {
      if (slots.left) out.push(slots.left);
    } else if (onRecord) {
      out.push({
        id: 'back',
        label: `Back to ${surface.label}`,
        icon: 'ChevronLeft',
        onPress: () => go({ r: null, mode: null }),
      });
    }
    for (const action of rightActions) if (action !== primary) out.push(action);
    out.push(...overflow);
    return out;
  }, [slots.left, onRecord, surface, go, rightActions, primary, overflow]);

  /* --- the payload -------------------------------------------------------- */

  const primaryOut = useMemo(() => {
    if (!primary) return null;
    const busy = primary.busy === true;
    return {
      id: primary.id,
      label: busy ? primary.busyLabel || primary.label : primary.label,
      run: () => press(primary),
      disabled: primary.disabled === true || busy,
      busy,
      danger: primary.tone === 'danger',
    };
  }, [primary]);

  const state = useMemo(() => {
    const message = showDefaultStatus ? dirtySentence(dirty, model.actions) : slots.status || null;
    if (!message) return null;
    return { dirty: dirty.dirty === true, error: !!dirty.error, message };
    // `model.actions` rather than a destructured `actions` so this list stays
    // honest about what it reads; it is the same state object either way.
  }, [showDefaultStatus, dirty, model.actions, slots.status]);

  const payload = useMemo(
    () => ({
      surface: { key: surface.key, label: surface.label, shortLabel: surface.shortLabel },
      actions: { primary: primaryOut, more: secondary.length },
      state,
    }),
    [surface, primaryOut, secondary.length, state],
  );

  useEffect(() => {
    publish(payload);
  }, [publish, payload]);

  // Leave the chrome as we found it. Two things to undo, and they are separate:
  // the published surface (or the bar keeps a Save button for a page that is
  // gone), and an open admin panel (or the site is left holding a panel whose
  // body has just unmounted, with no button on screen to close it). Read the
  // panel through a ref so this cleanup can run once, on unmount, without
  // closing the sky sheet somebody opened in between.
  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(
    () => () => {
      publish(null);
      if (panelRef.current === ADMIN_NAV_PANEL || panelRef.current === ADMIN_ACTIONS_PANEL) {
        closePanel();
      }
    },
    [publish, closePanel],
  );

  /* --- the panels ---------------------------------------------------------- */

  return (
    <>
      <AdminSurfaceSheet
        asPanel
        id={ADMIN_NAV_PANEL_ID}
        open={panel === ADMIN_NAV_PANEL}
        onClose={closePanel}
      />

      <BottomSheet
        id={ADMIN_ACTIONS_PANEL_ID}
        open={panel === ADMIN_ACTIONS_PANEL}
        onClose={closePanel}
        label={`${surface.label} — status and actions`}
        className="wb-panel wb-panel-actions"
      >
        {state && (
          <div
            className="wb-panel-state"
            data-dirty={state.dirty ? '' : undefined}
            data-error={state.error ? '' : undefined}
          >
            <BarStatus model={model} />
          </div>
        )}
        {secondary.length > 0 && (
          <ul className="wb-sheet-list">
            {secondary.map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  className="wb-sheet-row"
                  data-tone={action.tone || 'quiet'}
                  disabled={action.disabled === true || action.busy === true}
                  aria-busy={action.busy === true ? 'true' : undefined}
                  onClick={() => press(action, closePanel)}
                >
                  {action.icon && <SurfaceIcon name={action.icon} size={17} />}
                  <span className="wb-sheet-row-label">
                    {action.busy ? action.busyLabel || action.label : action.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </>
  );
}
