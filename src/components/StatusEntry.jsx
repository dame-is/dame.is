import { Link } from 'react-router-dom';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import RelativeTimeText from './RelativeTimeText.jsx';
import VitalsChip from './VitalsChip.jsx';

export default function StatusEntry({ payload, atUri, createdAt }) {
  const text = (payload?.status || payload?.text || '').trim();
  const ts = createdAt || payload?.createdAt;
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/logging/${rkey}` : null;
  return (
    <article className="status-entry feed-card" data-at-uri={atUri}>
      <div className="status-entry-row">
        <p className="status-entry-text">
          <span className="status-entry-prefix">dame.is</span>{' '}
          <span className="status-entry-body">
            {text ? renderPlainTextWithTruncatedUrls(text) : <em>—</em>}
          </span>
        </p>
        {ts && (
          recordHref ? (
            <Link className="gutter status-entry-time" to={recordHref}>
              <RelativeTimeText value={ts} />
            </Link>
          ) : (
            <span className="gutter status-entry-time"><RelativeTimeText value={ts} /></span>
          )
        )}
      </div>
      {payload?.stateRef?.uri && <VitalsChip stateRef={payload.stateRef} />}
    </article>
  );
}
