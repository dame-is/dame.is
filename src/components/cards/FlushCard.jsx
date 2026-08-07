/**
 * Renders a flush — an `im.flushing.right.now` record written from
 * flushes.app.
 *
 * A flush is two fields: one emoji and a fragment of a sentence whose
 * subject is the author's handle. So the card is laid out the way a
 * logging status is (see StatusEntry) — the handle, then the fragment —
 * with the emoji leading as the thing the author actually chose. Since
 * this handle ends in ".is", `flushBody` drops the stored "is " and the
 * row reads "dame.is flushing", which is the sentence the whole site is
 * named around.
 *
 * The timestamp links to the on-site record page; a quiet footer link goes
 * out to the flush on flushes.app, where its reactions and replies live.
 * The emoji is left to the reader's own emoji dictionary rather than given
 * a hand-written label: flushes.app names them because there they are the
 * entire content of thirty otherwise-identical buttons, but here the glyph
 * sits beside the text that carries the meaning.
 */
import { Link } from 'react-router-dom';
import { ME_HANDLE } from '../../config.js';
import { rkeyFromAtUri } from '../../lib/atproto.js';
import { flushBody, flushPermalink } from '../../lib/flushText.js';
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import RelativeTimeText from '../RelativeTimeText.jsx';

export default function FlushCard({ payload, atUri, createdAt }) {
  const emoji = payload?.emoji || '';
  const body = flushBody(payload?.text, ME_HANDLE);
  const ts = createdAt || payload?.createdAt;
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/flushing/${encodeURIComponent(rkey)}` : null;
  const permalink = flushPermalink(atUri, ME_HANDLE);

  return (
    <article className="flush-card feed-card" data-at-uri={atUri}>
      <div className="flush-card-row">
        <p className="flush-card-text">
          {emoji && <span className="flush-card-emoji">{emoji}</span>}
          <span className="flush-card-prefix">{ME_HANDLE}</span>{' '}
          <span className="flush-card-body">
            {body ? renderPlainTextWithTruncatedUrls(body) : <em>—</em>}
          </span>
        </p>
        {ts &&
          (recordHref ? (
            <Link className="gutter flush-card-time" to={recordHref}>
              <RelativeTimeText value={ts} />
            </Link>
          ) : (
            <span className="gutter flush-card-time">
              <RelativeTimeText value={ts} />
            </span>
          ))}
      </div>
      {permalink && (
        <p className="flush-card-on gutter small-caps">
          <a href={permalink} target="_blank" rel="noreferrer noopener">
            on flushes.app
          </a>
        </p>
      )}
    </article>
  );
}
