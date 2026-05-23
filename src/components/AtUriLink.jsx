import { Link } from 'react-router-dom';
import { explorerPathFromAtUri } from '../lib/atproto.js';

/**
 * Renders an `at://` URI (or DID) as a `<Link>` to the explorer page for
 * that record / collection / repo. Falls back to plain text when the URI
 * can't be parsed.
 *
 * Use this anywhere an AT URI is displayed in the UI as user-facing text.
 *
 *   <AtUriLink uri={atUri} />
 *   <AtUriLink uri={atUri}>{customLabel}</AtUriLink>
 *   <AtUriLink uri={atUri} className="…" />
 */
export default function AtUriLink({ uri, children, className }) {
  const path = explorerPathFromAtUri(uri);
  const label = children ?? uri;
  if (!path) return <span className={className}>{label}</span>;
  return (
    <Link to={path} className={className}>
      {label}
    </Link>
  );
}
