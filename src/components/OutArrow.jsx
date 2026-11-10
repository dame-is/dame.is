import { ArrowUpRight } from 'lucide-react';

/**
 * The mark on a link that leaves the site or opens a new tab.
 *
 * Drawn, never typed. The character for it (U+2197) is one a phone may show
 * as an emoji: on iOS it comes out as a blue tile in the middle of a line of
 * text. This scales with the type it sits in and takes its colour.
 */
export default function OutArrow({ size = '0.9em' }) {
  return <ArrowUpRight className="out-arrow" size={size} aria-hidden="true" />;
}
