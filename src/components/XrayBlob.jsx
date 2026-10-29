import { blobFacts, formatBytes, indexSpans, shortenCid } from '../lib/xray.js';

/** Width over height at which a picture's plate moves under it. */
const WIDE = 3;

/**
 * X-ray's plate over a picture or a video: where it sits in its record and
 * the blob under it, its CID and, when the record says, its type, its size
 * and the aspect ratio the record declared. Laid over the frame and hidden
 * from assistive tech, which hears it as the control's description instead
 * (aria-describedby): a button's contents are presentational, so a plate
 * inside one would otherwise say nothing. `head` sets it across the top, off
 * a video's controls. A picture three or more times wider than it is tall (a
 * strip of browser tabs) is too short to carry it, so there it sits under the
 * picture, inside the frame. Shared by a post's media (PostEmbed) and a
 * document's image blocks (LeafletDocument).
 */
export function BlobPlate({ id, field, blob, url, aspectRatio, place = 'foot', hidden = true }) {
  const facts = blobFacts(blob, url);
  const known = aspectRatio?.width > 0 && aspectRatio?.height > 0;
  const ratio = known ? `${aspectRatio.width}:${aspectRatio.height}` : null;
  const where =
    place === 'foot' && known && aspectRatio.width / aspectRatio.height >= WIDE ? 'under' : place;
  const line = [facts?.mimeType, facts?.size != null ? formatBytes(facts.size) : null, ratio]
    .filter(Boolean)
    .join(' · ');
  return (
    <span id={id} className={`xray-blob xray-blob-${where}`} aria-hidden={hidden ? 'true' : undefined}>
      <span className="xray-blob-field">
        {field} <span className="xray-blob-kind">· blob</span>
      </span>
      {facts?.cid && <span className="xray-blob-cid">{shortenCid(facts.cid)}</span>}
      {line && <span className="xray-blob-facts">{line}</span>}
    </span>
  );
}

/**
 * Alt text the page otherwise only hands a screen reader, printed in x-ray
 * by its field. `items` are `{ index, alt }`, `field(n)` writes the path for
 * an index or a run of them ("images[0].alt", "blocks[7–23].alt"). The
 * pictures with none share one line rather than each saying so, which on a
 * gallery of seventeen was seventeen lines of "none". Hidden from assistive
 * tech, which already has each as its picture's name.
 */
export function AltList({ items, field }) {
  if (!items?.length) return null;
  const written = items.filter((it) => it.alt);
  const missing = items.filter((it) => !it.alt).map((it) => it.index);
  return (
    <dl className="xray-alts" aria-hidden="true">
      {written.map((it) => (
        <div key={it.index} className="xray-alt">
          <dt>{field(String(it.index))}</dt>
          <dd>{it.alt}</dd>
        </div>
      ))}
      {missing.length > 0 && (
        <div className="xray-alt">
          <dt>{field(indexSpans(missing))}</dt>
          <dd>
            <em>none</em>
          </dd>
        </div>
      )}
    </dl>
  );
}
