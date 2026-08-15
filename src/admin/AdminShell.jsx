// The persistent admin frame — mounted exactly once, from Admin.jsx, after the
// three gates. It reads `c` / `r` / `mode` / `view` / `for` from the query
// string and NEVER changes its own element type, so every navigation inside the
// admin reconciles instead of remounting. That is the whole point of the
// rebuild: the list column keeps its scroll position and its filter, the rail
// stays put, and RouteTransition plays no crossfade because the pathname is
// always `/admin`.
//
// Two document-level side effects live here and nowhere else:
//
//  1. `data-admin-shell` on <html>. adminShell.css uses it to widen `.main`,
//     which app.css caps at 72rem. It MUST be removed on unmount or the public
//     site inherits the admin's full-bleed layout. RouteTransition runs
//     `mode="wait"`, so this cleanup lands before any public page paints.
//  2. `exit()` from useEditMode, once on mount. An owner who enters select mode
//     on /logging and then reaches /admin by the ChromeBar home button, the
//     browser back button, or a typed URL arrives with edit mode still `active`
//     — useEditMode's route-change effect deliberately does not reset it. The
//     result would be an empty "Tap items to select" bar over the workbench and
//     a non-zero `--edit-bar-h` reserving space in .app-shell's padding sum.

import { useEffect, useMemo, useRef } from 'react';
import PageShell from '../components/PageShell.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import AdminRail from './AdminRail.jsx';
import AdminStatusStrip from './AdminStatusStrip.jsx';
import AdminTopBar from './AdminTopBar.jsx';
import FrontDesk from './FrontDesk.jsx';
import RecordDetail from './panes/RecordDetail.jsx';
import RecordListPane from './panes/RecordListPane.jsx';
import StudioPane from './panes/StudioPane.jsx';
import { AdminShellProvider, useShellState } from './useAdminShell.jsx';
import './adminShell.css';

// The three panes were `import.meta.glob` lookups while they were being written
// by other hands — the glob yields nothing for a file that does not exist yet,
// which let the shell ship a working frame before any pane had landed. They are
// all here now, so they are plain static imports: a glob would keep the shell
// rendering a polite "not built yet" placeholder for a pane that failed to
// resolve, when a missing module should be a build error. It also removes a real
// dev-server trap — Vite expands `import.meta.glob` at TRANSFORM time and does
// not re-expand it when a newly created file starts matching, so a new pane kept
// rendering as missing until its importer was touched.

/**
 * @param {object} props
 * @param {object} props.agent
 * @param {string} props.did
 */
export default function AdminShell({ agent, did }) {
  const ctx = useShellState({ agent, did });
  const { surface, collection, rkey, isNew, preset, stacked, column, actions } = ctx;

  // Widen `.main` for as long as the shell is mounted. `delete` rather than
  // setting an empty attribute so the public site's `.main` selector matches
  // nothing at all once we are gone.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.adminShell = '';
    return () => {
      delete root.dataset.adminShell;
    };
  }, []);

  // Clear any residual select mode inherited from a public route. `exit` is
  // useCallback-stable, so this runs exactly once.
  const { exit } = useEditMode();
  useEffect(() => {
    exit();
  }, [exit]);

  // Cmd/Ctrl+S saves whatever the detail pane registered. Bound to the shell's
  // own root rather than to `document`, so it cannot fire over a public page,
  // and NOT extended with an undo binding — BlocksEditor already owns Cmd/Ctrl+Z
  // scoped to its own root.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const onKeyDown = useMemo(
    () => (event) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
      const current = actionsRef.current;
      if (!current?.save || current.saving || current.deleting || current.loading) return;
      event.preventDefault();
      current.save();
    },
    [],
  );

  const isList = surface.kind === 'records-list';
  // Exactly one column is RENDERED when stacked — the other is unmounted, not
  // hidden. Safe: the list's records are re-fetched from the counts cache, and
  // the detail pane's editor state is per-record anyway.
  const showList = isList && (!stacked || column === 'list');
  const showDetail = !isList || !stacked || column === 'detail';
  // Not a column count — that is `showList`'s job. This drops the `--measure`
  // clamp inside the detail pane, for the studios whose bodies are inherently
  // wide (the sky palette grid, the ratioed live feed) and for the Front Desk,
  // which owns its own grid.
  const fullWidth = surface.fullWidth === true || surface.kind === 'dashboard';

  // The shell never fetches a record, so it titles the tab with the rkey rather
  // than with a record title it would have to invent or wait for. The detail
  // pane is free to narrow it further through its own AtUriHead.
  const headTitle = rkey
    ? `${rkey} — ${surface.label} — Admin — dame.is`
    : `${surface.label} — Admin — dame.is`;

  // Three kinds, three panes, and `surface.kind` is exhaustive — resolveSurface
  // mints a synthetic `records-list` surface for an NSID the registry has never
  // heard of, so there is no fourth branch and no surface can fall through to a
  // blank pane.
  let detailPane;
  if (surface.kind === 'dashboard') {
    detailPane = <FrontDesk />;
  } else if (surface.kind === 'studio') {
    detailPane = <StudioPane surface={surface} agent={agent} did={did} rkey={rkey} isNew={isNew} />;
  } else {
    detailPane = (
      <RecordDetail
        surface={surface}
        agent={agent}
        did={did}
        collection={collection}
        // `mode=new` beats `r`, exactly as the old param ladder did.
        rkey={isNew ? null : rkey}
        preset={preset}
      />
    );
  }

  return (
    <AdminShellProvider value={ctx}>
      {/* No title and no intro: the shell draws its own headers. This PageShell
          exists to register `pageRecord = null` + `selectionPage = false` — so a
          stale selection page from a public feed cannot leak into the admin —
          and to set document.title through AtUriHead. Every studio therefore
          stops rendering one of its own. */}
      <PageShell headTitle={headTitle}>
        <div
          className="wb"
          data-surface={surface.key}
          data-stacked={stacked ? '' : undefined}
          data-full-width={fullWidth ? '' : undefined}
          onKeyDown={onKeyDown}
        >
          <AdminTopBar />
          <div className="wb-shell">
            <AdminRail />
            {showList && (
              <div className="wb-pane wb-pane-list">
                <RecordListPane surface={surface} agent={agent} did={did} />
              </div>
            )}
            {showDetail && (
              <div className="wb-pane wb-pane-detail">
                {/* FIRST child, always. That is what lets one element be
                    top-sticky on desktop and bottom-sticky when stacked: a
                    first-child sticky box with only `bottom` set floats down to
                    the scrollport bottom and pins there. It renders null when
                    there is nothing to say. */}
                <AdminStatusStrip />
                {detailPane}
              </div>
            )}
          </div>
        </div>
      </PageShell>
    </AdminShellProvider>
  );
}
