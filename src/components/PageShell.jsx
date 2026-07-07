import { useEffect } from 'react';
import AtUriHead from './AtUriHead.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';

/**
 * Shared page container — optional title + intro (each only renders when
 * provided), plus the AT URI <head> hints for the route's backing record.
 */
export default function PageShell({ title, intro, atUri, cid, children, headTitle, eyebrow }) {
  // Publish the route's backing record to edit mode so the owner's quick-edit
  // sheet can target "this page" (a blog post, the home page record, etc.).
  const { registerPageRecord } = useEditMode();
  useEffect(() => {
    registerPageRecord(atUri ? { atUri, cid } : null);
  }, [atUri, cid, registerPageRecord]);

  return (
    <article className="page">
      <AtUriHead atUri={atUri} cid={cid} title={headTitle} />
      {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
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
