// The engagement chip: what a record did to a piece, in one mark.
//
// A feed row shows the mark alone — a speech bubble, a repeat, a pair of quote
// marks, a heart. The word that used to sit beside it said nothing the icon
// doesn't, and said it in a box five ems wide on a row whose two useful columns
// are the handle and what that person wrote; on a phone both were being cut to
// fit a label spelling REPOST.
//
// Three of the four are drawn in the page's faint ink, which is the point of
// the change: reply, repost and quote are the same KIND of event, they are what
// a post collecting replies looks like, and colour-coding them made three
// ordinary things look like three different alarms. The like is the one that is
// not engagement — it is the end of the piece — so it keeps the complement of
// the hour (the seal colour the charts and the replay draw it in), it is
// filled rather than outlined, and while a piece is running it throbs. It is
// the only coloured mark in the column, which is what makes it findable in a
// feed somebody is scanning in order to act within seconds.
//
// The alarm the deck and the studio raise for that like is the same component
// at `size="lg"`, and there the word comes back: a band across the top of a
// panel is not a column being scanned, and it has the room to say what it is.

import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import './RatioedChip.css';

const LABEL = { like: 'like', repost: 'repost', quote: 'quote', reply: 'reply' };
const ICON = { like: Heart, repost: Repeat2, quote: Quote, reply: MessageCircle };

/**
 * `kind` is one of like/repost/quote/reply. `size` is `'sm'` for a feed row —
 * the icon on its own — or `'lg'` for the alarm that a like raises, which
 * carries the word as well. `muted` drops the animation for a like that has
 * been withdrawn, or one being replayed years later — the colour still says
 * what it was, the urgency is over.
 */
export default function RatioedChip({ kind, size = 'sm', muted = false }) {
  const k = LABEL[kind] ? kind : 'reply';
  const Icon = ICON[k];
  const big = size === 'lg';
  // Named for a reader only where the name isn't already on screen. At `lg`
  // the word is right there, and labelling the box as an image would hide it.
  const named = big ? {} : { role: 'img', 'aria-label': LABEL[k], title: LABEL[k] };
  return (
    <span
      className={`rk-chip rk-${k} rk-${size}${muted ? ' is-muted' : ''}`}
      data-kind={k}
      {...named}
    >
      <Icon
        size={big ? 16 : 14}
        fill={k === 'like' ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      {big && LABEL[k]}
    </span>
  );
}
