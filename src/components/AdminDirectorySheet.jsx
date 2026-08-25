// The owner's way into the admin from ANYWHERE on the site — the panel behind
// the persistent admin button that rides the bottom chrome beside the compass.
//
// It is the public-route sibling of the admin's own Surfaces sheet
// (AdminSurfaceSheet). That sheet cannot serve here: it reads the admin shell
// context (current surface, unsaved-changes guard, the counts cache), none of
// which exists outside /admin. This one is deliberately less: a directory of
// LINKS, grouped exactly as the rail groups them, with no counts and no
// state — because from a public page there is no admin state to consult.
//
// Bundle discipline, the same rule ChromeBar states for the admin's own
// buttons: this wrapper imports NOTHING from src/admin/. The directory body —
// which reads the surface registry and the icon map — is a `lazy()` chunk
// fetched the first time the OWNER opens the panel, so a visitor pays nothing
// for it and even the owner pays only on use.

import { Suspense, lazy } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';

/**
 * Panel name + body id, the same contract ADMIN_NAV_PANEL follows: the
 * trigger lives in ChromeBar, the panel here, and `aria-controls` has to
 * agree across the seam.
 */
export const ADMIN_DIRECTORY_PANEL = 'admin-directory';
export const ADMIN_DIRECTORY_PANEL_ID = 'chrome-admin-directory-sheet';

const DirectoryBody = lazy(() => import('./AdminDirectoryBody.jsx'));

export default function AdminDirectorySheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === ADMIN_DIRECTORY_PANEL;
  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      id={ADMIN_DIRECTORY_PANEL_ID}
      label="Admin directory"
      size="fill"
      className="wb-panel chrome-admin-directory"
    >
      {/* Mounted only while open, so the lazy chunk is fetched on first use,
          never on page load. */}
      {open && (
        <Suspense fallback={<p className="chrome-admin-directory-loading">Opening the directory…</p>}>
          <DirectoryBody onNavigate={closePanel} />
        </Suspense>
      )}
    </BottomSheet>
  );
}
