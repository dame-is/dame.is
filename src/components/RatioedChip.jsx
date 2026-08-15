// The engagement chip: what a record did to a piece, in one mark.
//
// The colours are the chart scale, which is derived from whatever hour the sky
// theme is showing (see lib/ratioedPalette.js) and written onto the surrounding
// element as custom properties. Reply, repost and quote are an analogous trio
// around that hour's own hue — monochromatic on purpose, because they are the
// same KIND of event and the eye should read them as a family, sorted by
// gradation rather than by colour-coding.
//
// The like is the hour's complement at higher chroma, and it is the only thing
// on this scale that is not engagement: it is the end of the piece. So it does
// not sit quietly in the family. It is heavier, ringed, and it moves — the
// panel it appears in is one somebody is watching in order to act within
// seconds, and an alarm you have to read is not an alarm.

import { Heart } from 'lucide-react';
import './RatioedChip.css';

const LABEL = { like: 'like', repost: 'repost', quote: 'quote', reply: 'reply' };

/**
 * `kind` is one of like/repost/quote/reply. `size` is `'sm'` for a feed row or
 * `'lg'` for the alarm that a like raises. `muted` drops the animation and the
 * ring for a like that has been withdrawn, or one being replayed years later —
 * the colour still says what it was, the urgency is over.
 */
export default function RatioedChip({ kind, size = 'sm', muted = false }) {
  const k = LABEL[kind] ? kind : 'reply';
  return (
    <span
      className={`rk-chip rk-${k} rk-${size}${muted ? ' is-muted' : ''}`}
      data-kind={k}
    >
      {k === 'like' && <Heart size={size === 'lg' ? 16 : 11} fill="currentColor" aria-hidden="true" />}
      {LABEL[k]}
    </span>
  );
}
