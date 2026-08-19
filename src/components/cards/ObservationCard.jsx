/**
 * Renders one iNaturalist observation in the home feed — shared by the
 * `mothing` (`is.dame.mothing.observation`) and `observing`
 * (`is.dame.observing.observation`) verbs, which store the identical shape
 * and differ only by taxonomy. The record is mirrored from iNaturalist and
 * carries no location — a thumbnail, the taxon name (common + scientific),
 * and a link out to the iNaturalist observation. The feed row's own timestamp
 * shows when it was observed (the record's `createdAt` is derived from the
 * observation date).
 *
 * A RUN of observations — a night at the light logs dozens — arrives here
 * already collapsed into one item carrying `count` + `observations` (see
 * lib/observationBatches.js). That renders as a strip of specimens with the
 * count as an expand toggle, the same shape a batched listening session
 * takes; see ObservationBatchCard below.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { photoUrl } from '../../lib/inaturalist.js';
import { formatWallClockTime } from '../../lib/time.js';
import { formatNightDate, nightPath } from '../../lib/mothing.js';
import {
  batchCountLabel,
  batchNameLine,
  isObservationBatch,
} from '../../lib/observationBatches.js';

/** How many specimens the collapsed card previews. */
const BATCH_THUMBS = 6;

const fallbackName = (verb) =>
  verb === 'mothing' ? 'Unidentified moth' : 'Unidentified organism';

export default function ObservationCard(props) {
  if (isObservationBatch(props)) return <ObservationBatchCard {...props} />;
  const { payload, atUri, verb } = props;
  const obs = payload || {};
  const photos = Array.isArray(obs.photos) ? obs.photos : [];
  const first = photos[0];
  const src = first ? photoUrl(first, 'medium') : null;
  const common = obs.taxon?.commonName;
  const sci = obs.taxon?.name;
  const title = common || sci || fallbackName(verb);
  const showSci = sci && sci !== title;
  const alt = common || sci || (verb === 'mothing' ? 'Moth observation' : 'iNaturalist observation');

  return (
    <article className="moth-card feed-card" data-at-uri={atUri}>
      {src && (
        <a
          className="moth-card-thumb"
          href={obs.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View ${alt} on iNaturalist`}
        >
          <img src={src} alt={alt} loading="lazy" decoding="async" />
        </a>
      )}
      <div className="moth-card-body">
        <h3 className="moth-card-title">
          {obs.url ? (
            <a href={obs.url} target="_blank" rel="noreferrer noopener">{title}</a>
          ) : (
            title
          )}
        </h3>
        {showSci && <span className="moth-card-sci">{sci}</span>}
        {obs.qualityGrade === 'research' && (
          <span className="small-caps moth-card-grade">Research grade</span>
        )}
        {obs.description && (
          <p className="moth-card-desc">{renderPlainTextWithTruncatedUrls(obs.description)}</p>
        )}
      </div>
    </article>
  );
}

/**
 * A collapsed run: the specimens as a strip, the species it turned up, and a
 * count that opens the whole list. A mothing run is a night, so it says which
 * one and links to the night's own page.
 */
function ObservationBatchCard(item) {
  const [expanded, setExpanded] = useState(false);
  const { verb, observations, nightDate } = item;
  const shown = observations.filter((o) => o.payload?.photos?.[0]).slice(0, BATCH_THUMBS);
  const names = batchNameLine(item);

  return (
    <article className="moth-card moth-batch feed-card">
      {shown.length > 0 && (
        <div className="moth-batch-strip">
          {shown.map((o) => (
            <a
              key={o.atUri || o.payload.inatId}
              className="moth-batch-thumb"
              href={o.payload.url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`View ${o.payload.taxon?.commonName || o.payload.taxon?.name || 'observation'} on iNaturalist`}
            >
              <img
                src={photoUrl(o.payload.photos[0], 'medium')}
                alt=""
                loading="lazy"
                decoding="async"
              />
            </a>
          ))}
        </div>
      )}

      <div className="moth-card-body">
        <h3 className="moth-card-title">{names || fallbackName(verb)}</h3>
        <p className="moth-batch-meta gutter">
          <button
            type="button"
            className="moth-batch-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} all ${batchCountLabel(item)}`}
          >
            {batchCountLabel(item)}
            <span className="moth-batch-caret" aria-hidden="true">{expanded ? '−' : '+'}</span>
          </button>
          {nightDate && (
            <>
              {' · '}
              <Link to={nightPath(nightDate)}>Night of {formatNightDate(nightDate)}</Link>
            </>
          )}
        </p>
      </div>

      {expanded && (
        <ol className="moth-batch-list">
          {observations.map((o) => (
            <BatchRow key={o.atUri || o.payload?.inatId} item={o} verb={verb} />
          ))}
        </ol>
      )}
    </article>
  );
}

/** One sighting inside an expanded run: thumb, names, and its wall-clock. */
function BatchRow({ item, verb }) {
  const obs = item.payload || {};
  const photo = obs.photos?.[0];
  const thumb = photo ? photoUrl(photo, 'square') : null;
  const common = obs.taxon?.commonName;
  const sci = obs.taxon?.name;
  const name = common || sci || fallbackName(verb);
  const showSci = sci && sci !== name;
  const inner = (
    <>
      {thumb ? (
        <img className="moth-batch-row-thumb" src={thumb} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="moth-batch-row-thumb moth-batch-row-thumb-empty" aria-hidden="true" />
      )}
      <span className="moth-batch-row-names">
        <span className="moth-batch-row-name">{name}</span>
        {showSci && <span className="moth-batch-row-sci">{sci}</span>}
      </span>
      <span className="moth-batch-row-time gutter">
        {formatWallClockTime(obs.observedTime)}
      </span>
    </>
  );
  return (
    <li className="moth-batch-row" data-at-uri={item.atUri || undefined}>
      {obs.url ? (
        <a
          className="moth-batch-row-link"
          href={obs.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {inner}
        </a>
      ) : (
        <span className="moth-batch-row-link">{inner}</span>
      )}
    </li>
  );
}
