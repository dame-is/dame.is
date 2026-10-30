import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import AtUriHead from './AtUriHead.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useChromeBar } from '../hooks/useChromeBar.jsx';

/**
 * Shared page container — optional title + intro (each only renders when
 * provided), plus the AT URI <head> hints for the route's backing record.
 *
 * `selectable` marks a route that hosts its own owner edit-mode UI: feed-row
 * selection (the home / posting / logging / listening feeds) or guestbook
 * moderation. Those keep the pencil's "tap items to select" flow; every other
 * page has nothing to select, so the pencil opens its record editor directly
 * (see ChromeBar). Defaults to false — set it on new feed-style pages.
 *
 * The chrome's trail is the URL, so a page can't rename its last crumb.
 * `crumbNote` is printed at the right of the masthead's trail: a thread
 * post's place in its thread, "3 of 6".
 *
 * `facts` is a short line set under the title, before the intro: a gallery's
 * "Updated October 29, 2026 · 250 blocks · 2 years old".
 */
export default function PageShell({
  title,
  intro,
  facts,
  above,
  atUri,
  cid,
  children,
  headTitle,
  crumbNote = null,
  selectable = false,
}) {
  // Publish the route's backing record to edit mode so the owner's quick-edit
  // sheet can target "this page" (a blog post, the home page record, etc.).
  const { registerPageRecord, registerSelectionPage } = useEditMode();
  useEffect(() => {
    registerPageRecord(atUri ? { atUri, cid } : null);
  }, [atUri, cid, registerPageRecord]);
  useEffect(() => {
    registerSelectionPage(selectable);
  }, [selectable, registerSelectionPage]);
  const { pathname } = useLocation();
  const { setCrumbNote } = useChromeBar();
  useEffect(() => {
    if (!crumbNote) return undefined;
    setCrumbNote({ path: pathname, note: crumbNote });
    return () => setCrumbNote((cur) => (cur?.path === pathname ? null : cur));
  }, [crumbNote, pathname, setCrumbNote]);

  return (
    <article className="page">
      <AtUriHead atUri={atUri} cid={cid} title={headTitle} />
      {/* Anything that belongs before the title rather than inside the page:
          a breadcrumb up to the parent, chiefly. A page whose title is not the
          first thing a reader meets is the exception, so this stays opt-in. */}
      {above}
      {title && (
        <h1 className="page-title">
          {title}
        </h1>
      )}
      {facts && <p className="page-facts">{facts}</p>}
      {intro && <p className="page-intro">{intro}</p>}
      {children}
    </article>
  );
}
