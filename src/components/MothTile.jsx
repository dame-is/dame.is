// The two atoms the mothing surfaces share: a photo tile and a stat block.
// Both are used by the index (/mothing) and by a single night
// (/mothing/2026-08-18), which draws the same observations at the same size —
// so they live here rather than being written twice and drifting apart.

import { photoUrl } from '../lib/inaturalist.js';
import { mothName } from '../lib/mothing.js';

/**
 * One observation as an image tile that opens the in-page lightbox (the
 * iNaturalist link moves into the lightbox's "source" control). Photoless
 * observations fall back to a static placeholder tile.
 */
export function MothTile({ obs, onOpen }) {
  const photo = obs.photos?.[0];
  const src = photo ? photoUrl(photo, 'medium') : null;
  // A tile is 192–356 CSS px and square-cropped, so what it consumes is the
  // photo's SHORT edge: iNaturalist's `medium` (500×375 on a 4:3 frame) has
  // 375px of it, which is under 1:1 on any retina display — a 356px tile on a
  // 3× phone wants 1068. `large` carries 768 and covers both. Offered as a 2×
  // candidate rather than swapped outright so a 1× screen still pays 212kB
  // instead of 856kB. Same shape the curating grid uses for its are.na
  // blocks. It also means opening the lightbox is a cache hit on retina: the
  // viewer's full image IS this file (see mothLightboxImages).
  const srcSet = photo ? `${src} 1x, ${photoUrl(photo, 'large')} 2x` : undefined;
  const title = mothName(obs);
  const sci = obs.taxon?.name;
  const showSci = sci && sci !== title;
  const caption = (
    <span className="mothing-tile-caption">
      <span className="mothing-name">{title}</span>
      {showSci && <span className="mothing-sci">{sci}</span>}
    </span>
  );
  return (
    <li className="mothing-cell">
      {src ? (
        <button
          type="button"
          className="mothing-tile"
          onClick={() => onOpen(obs)}
          aria-label={`View photo: ${title}`}
        >
          <img src={src} srcSet={srcSet} alt={title} loading="lazy" decoding="async" />
          {caption}
        </button>
      ) : (
        <div className="mothing-tile mothing-tile-empty">
          <div className="mothing-placeholder" aria-hidden="true">&#x1F98B;</div>
          {caption}
        </div>
      )}
    </li>
  );
}

/**
 * One figure in the stats band. Numbers get thousands separators; a string
 * value (a time span, say) is printed as given. Renders nothing for a missing
 * value, so callers can list every stat a surface might have.
 */
export function MothStat({ value, label }) {
  if (value == null || value === '') return null;
  return (
    <div className="mothing-stat">
      <span className="mothing-stat-value">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      <span className="mothing-stat-label small-caps">{label}</span>
    </div>
  );
}
