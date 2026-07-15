import { useEffect } from 'react';
import AtUriHead from './AtUriHead.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';

/**
 * Shared page container — optional title + intro (each only renders when
 * provided), plus the AT URI <head> hints for the route's backing record.
 *
 * `selectable` marks a route that hosts its own owner edit-mode UI: feed-row
 * selection (the home / posting / logging / listening feeds) or guestbook
 * moderation. Those keep the pencil's "tap items to select" flow; every other
 * page has nothing to select, so the pencil opens its record editor directly
 * (see ChromeBar). Defaults to false — set it on new feed-style pages.
 */
export default function PageShell({
  title,
  intro,
  atUri,
  cid,
  children,
  headTitle,
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

  return (
    <article className="page">
      <AtUriHead atUri={atUri} cid={cid} title={headTitle} />
      {title && (
        <h1 className="page-title">
          {title}
        </h1>
      )}
      {intro && <p className="page-intro">{intro}</p>}
      {children}
    </article>
  );
}
