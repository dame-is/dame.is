// The photo tile the mothing surfaces share: the index's daytime fold and a
// single night (/mothing/2026-08-18) draw the same observations at the same
// size, so it lives here rather than being written twice and drifting apart.
// (The stats band is the shared Figures component now.)

import FirstSightingChip from './FirstSightingChip.jsx';
import Fleuron from './Fleuron.jsx';
import { photoUrl } from '../lib/inaturalist.js';
import { formatObservedTime, mothName } from '../lib/mothing.js';

/**
 * One observation as an image tile that opens the in-page lightbox (the
 * iNaturalist link moves into the lightbox's "source" control). Photoless
 * observations fall back to a static placeholder tile.
 *
 * `first` marks a lifer. The caller decides it, not the tile: whether a
 * species has been seen before is a question about the whole archive, and a
 * tile holds one sighting (see lib/firstSightings.js).
 */
export function MothTile({ obs, onOpen, first = false }) {
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
  // A specimen label: the time in small caps, the common name, the binomial
  // in italic, and the first-sighting mark on its own line when it applies.
  const time = formatObservedTime(obs.observedTime).replace(/(am|pm)$/, ' $1');
  const caption = (
    <span className="mothing-tile-caption">
      {time && <span className="mothing-time">{time}</span>}
      <span className="mothing-name">{title}</span>
      {showSci && <span className="mothing-sci">{sci}</span>}
      {first && <FirstSightingChip size="small" />}
    </span>
  );
  // The tile is named by its caption — common name, binomial, the lifer mark —
  // rather than an aria-label, which would replace it: a label short of what's
  // on screen hides the binomial from a screen reader, and voice control can't
  // find the tile by the words it shows. The photo's alt is empty so the name
  // isn't said twice; the caption under it already says what it is.
  return (
    <li className="mothing-cell">
      {src ? (
        <button
          type="button"
          className="mothing-tile"
          onClick={() => onOpen(obs)}
        >
          <img
            src={src}
            srcSet={srcSet}
            alt=""
            loading="lazy"
            decoding="async"
          />
          {caption}
        </button>
      ) : (
        <div className="mothing-tile mothing-tile-empty">
          <div className="mothing-placeholder" aria-hidden="true">
            <Fleuron />
          </div>
          {caption}
        </div>
      )}
    </li>
  );
}
