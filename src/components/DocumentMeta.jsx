import { relativeDay, relativeDayShort, formatDateFull, formatDateShort } from '../lib/time.js';

/**
 * The header band shared by the blog-post and creating-work document pages: a
 * two-line table of the document's own facts, set between hairline rules under
 * the title.
 *
 *   CREATED          ELAPSED        TAGGED
 *   June 27, 2025    1 year ago     performance
 *
 * Everything is left-aligned in equal columns. It replaces the older one-line
 * phrase ("Created 1 year ago on June 27, 2025") — three data points a reader
 * had to parse a sentence to pull apart, with the most distinctive one buried
 * in a trailing parenthetical.
 *
 * `date` is the date the document carries: a post's `publishedAt`, a work's
 * `createdAt`. `verb` names what happened then — a work is dated from when it
 * was made, which is rarely when the page about it went up — and doubles as
 * the first column's heading. `tag` is the document's primary tag; the page
 * decides which one that is (`workCategory` on /creating so the header agrees
 * with the index chip, `primaryTag` on /blogging where tags name subjects).
 *
 * With no tag — most blog posts — the third column isn't rendered and the
 * remaining two share the width, so an absent tag reads as absent rather than
 * as a broken third of the band.
 *
 * Each value carries a long and a short rendering; a container query on the
 * band picks between them, so the columns hold their shape in a narrow measure
 * without any of it depending on the viewport (the reading column is capped at
 * 65ch and narrows on a wide window too — split screen, the print view).
 */
export default function DocumentMeta({ date, verb = 'Published', tag = '', columns: given }) {
  // A caller with facts of its own hands in the columns directly — a Ratioed
  // piece is dated three times over (posted, sealed, measured) and none of them
  // is a publication date with a tag beside it. The band's shape is the thing
  // worth sharing; the date/verb/tag triple is only the common case.
  const columns = given || buildColumns(date, verb, tag);
  if (!columns?.length) return null;

  return (
    <dl className="document-meta" data-columns={columns.length}>
      {columns.map((col) => (
        <div key={col.key} className={`document-meta-pair document-meta-${col.key}`}>
          <dt className="document-meta-label">{col.label}</dt>
          <dd className="document-meta-value">
            {col.short === col.long ? (
              col.long
            ) : (
              <>
                <span className="document-meta-long">{col.long}</span>
                <span className="document-meta-short">{col.short}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The publication triple: when it was dated, how long ago that was, and what
 *  it is tagged. Null date means the document has nothing to date it by. */
function buildColumns(date, verb, tag) {
  if (!date) return null;
  const columns = [
    { key: 'date', label: verb, long: formatDateFull(date), short: formatDateShort(date) },
    { key: 'elapsed', label: 'Elapsed', long: relativeDay(date), short: relativeDayShort(date) },
  ];
  if (tag) columns.push({ key: 'tag', label: 'Tagged', long: tag, short: tag });
  return columns;
}
