import AtUriHead from './AtUriHead.jsx';

/**
 * Shared page container — running-header chapter title, optional intro,
 * and the AT URI <head> hints for the route's backing record.
 */
export default function PageShell({ verb, title, intro, atUri, cid, children, headTitle }) {
  return (
    <article className="page">
      <AtUriHead atUri={atUri} cid={cid} title={headTitle} />
      {verb && <div className="running-header">Dame is&hellip; {verb}</div>}
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
