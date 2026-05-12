import AtUriHead from './AtUriHead.jsx';

/**
 * Shared page container — optional title + intro (each only renders when
 * provided), plus the AT URI <head> hints for the route's backing record.
 */
export default function PageShell({ title, intro, atUri, cid, children, headTitle }) {
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
