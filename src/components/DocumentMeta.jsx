import { relativeDay, formatDateFull } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';

/**
 * The one-line publication stamp shared by the blog-post and creating-work
 * document pages:
 *
 *   Published 7 months ago on April 7, 2026 (Day 12,221)
 *
 * Rendered as a single flowing phrase — not the bullet-separated atoms the
 * `.blog-article-meta` container uses elsewhere — so the whole thing reads as
 * one sentence. Both pages render it identically, so it lives here to keep
 * them in sync rather than being duplicated per page.
 *
 * `date` is the document's publish date (a blog post's `publishedAt`, a work's
 * `createdAt`); the day number is that date's position in dame's day-of-life
 * count.
 */
export default function DocumentMeta({ date }) {
  if (!date) return null;
  const day = dayOfLife(date);
  return (
    <div className="blog-article-meta">
      <span>
        Published {relativeDay(date)} on {formatDateFull(date)}
        {day ? ` (Day ${day.toLocaleString()})` : ''}
      </span>
    </div>
  );
}
