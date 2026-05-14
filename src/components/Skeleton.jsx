import { motion } from 'motion/react';
import './Skeleton.css';

/**
 * Animated loading skeletons for record-driven pages.
 *
 * Two layered animations make the placeholders feel alive without being
 * noisy:
 *
 *   1. A slow shimmer sweep — a horizontal gradient on every individual
 *      `.skeleton` block (driven by CSS `background-position`). The
 *      gradient stops are pulled from the page palette so the effect
 *      reads as "blank parchment" rather than "Material UI".
 *
 *   2. A breathing fade — applied via Motion on the outer `SkeletonShell`.
 *      The wrapper fades the whole skeleton column in, then unmounts
 *      (still via Motion if wrapped in `AnimatePresence`) when real
 *      content arrives so the swap doesn't snap.
 *
 * The shimmer respects `prefers-reduced-motion` (CSS handles that), and
 * the Motion fade is short (~250ms) so reduced-motion users still get a
 * usable cue from the static gradient block.
 */

/**
 * One animated rectangle. Pass any subset of width/height/radius — the
 * defaults give you a single line of text on the current line-height.
 */
export function Skeleton({
  width,
  height = '1em',
  radius,
  className = '',
  block = false,
  style,
  ...rest
}) {
  return (
    <span
      className={`skeleton ${block ? 'skeleton-block' : ''} ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
}

/**
 * Several text-line skeletons stacked into a paragraph. The last line is
 * shorter so it reads more like real prose than a brick of text.
 */
export function SkeletonText({
  lines = 3,
  lineHeight = '0.85em',
  lastLineWidth = '60%',
  className = '',
}) {
  return (
    <span className={`skeleton-text ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? lastLineWidth : '100%'}
          height={lineHeight}
        />
      ))}
    </span>
  );
}

/**
 * Outer Motion fade for any skeleton. Used so the skeleton column fades
 * in (and, when wrapped in <AnimatePresence>, fades back out as the real
 * content swaps in). Adds aria-busy on the section so assistive tech
 * announces "loading" even though the inner blocks are aria-hidden.
 */
export function SkeletonShell({ children, className = '', label = 'Loading' }) {
  return (
    <motion.div
      className={`skeleton-shell ${className}`.trim()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------------- */
/* Page-shaped variants                                                  */
/* -------------------------------------------------------------------- */

/**
 * Skeleton for any feed list (Home, Posting, Logging). Mirrors the
 * `.feed-item` two-column grid (4.5rem verb badge + body) so the
 * placeholder doesn't reflow once the real items arrive.
 *
 * Each row's body has a couple of staggered text lines plus a tiny
 * timestamp on the right.
 */
export function FeedSkeleton({ rows = 6, label = 'Loading feed' }) {
  return (
    <SkeletonShell label={label}>
      <ul className="skeleton-feed">
        {Array.from({ length: rows }, (_, i) => {
          const longLine = 78 + ((i * 7) % 18); // 78 – 96 % to look organic
          const shortLine = 38 + ((i * 13) % 32); // 38 – 70 %
          return (
            <li key={i} className="skeleton-feed-item">
              <Skeleton className="skeleton-feed-verb" />
              <div className="skeleton-feed-body">
                <div className="skeleton-feed-row">
                  <Skeleton
                    className="skeleton-feed-text"
                    style={{ width: `${longLine}%` }}
                  />
                  <Skeleton className="skeleton-feed-time" />
                </div>
                {i % 3 !== 0 && (
                  <Skeleton
                    block
                    style={{ width: `${shortLine}%`, height: '0.85em' }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Skeleton for the Blogging table-of-contents. Mirrors the three-column
 * `.blogging-toc-entry` grid (number / body / meta).
 */
export function BloggingTocSkeleton({ rows = 5 }) {
  return (
    <SkeletonShell label="Loading blog index">
      <ul className="skeleton-toc">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="skeleton-toc-entry">
            <Skeleton className="skeleton-toc-num" />
            <div className="skeleton-toc-body">
              <Skeleton
                className="skeleton-toc-title"
                style={{ width: `${55 + ((i * 11) % 35)}%` }}
              />
              {i % 2 === 0 && (
                <Skeleton
                  className="skeleton-toc-summary"
                  style={{ width: `${65 + ((i * 7) % 25)}%` }}
                />
              )}
            </div>
            <Skeleton className="skeleton-toc-meta" />
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Skeleton for the Creating grid. Mirrors `.creating-grid` cells with a
 * 4:3 thumb plus the kind / title / time meta block.
 */
export function CreatingGridSkeleton({ cells = 6 }) {
  return (
    <SkeletonShell label="Loading works">
      <ul className="skeleton-grid">
        {Array.from({ length: cells }, (_, i) => (
          <li key={i} className="skeleton-grid-cell">
            <Skeleton className="skeleton-grid-thumb" />
            <div className="skeleton-grid-meta">
              <Skeleton className="skeleton-grid-kind" />
              <Skeleton
                className="skeleton-grid-title"
                style={{ width: `${55 + ((i * 9) % 30)}%` }}
              />
              <Skeleton className="skeleton-grid-time" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Skeleton for a single record page (Record.jsx). Renders a simple body
 * stub plus a thin meta row that mirrors `.record-page-meta`.
 */
export function RecordSkeleton() {
  return (
    <SkeletonShell label="Loading record">
      <div className="skeleton-record">
        <SkeletonText lines={3} lineHeight="1.05em" lastLineWidth="55%" />
        <div className="skeleton-record-meta">
          <Skeleton className="skeleton-record-meta-cell" />
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '3.5rem' }} />
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '6rem' }} />
        </div>
      </div>
    </SkeletonShell>
  );
}

/**
 * Skeleton for a long-form page (BlogPost). A meta row above a stack of
 * paragraph-shaped text skeletons.
 */
export function BlogPostSkeleton({ paragraphs = 4 }) {
  return (
    <SkeletonShell label="Loading post">
      <div className="skeleton-record">
        <div className="skeleton-record-meta">
          <Skeleton className="skeleton-record-meta-cell" />
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '4.5rem' }} />
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '6rem' }} />
        </div>
        {Array.from({ length: paragraphs }, (_, i) => (
          <SkeletonText
            key={i}
            lines={3 + (i % 2)}
            lineHeight="0.95em"
            lastLineWidth={`${40 + ((i * 17) % 35)}%`}
          />
        ))}
      </div>
    </SkeletonShell>
  );
}

/**
 * Skeleton for a Creating work page (image + summary + body).
 */
export function CreatingWorkSkeleton() {
  return (
    <SkeletonShell label="Loading work">
      <div className="skeleton-record">
        <div className="skeleton-record-meta">
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '4rem' }} />
          <Skeleton className="skeleton-record-meta-cell" style={{ width: '6.5rem' }} />
        </div>
        <SkeletonText lines={2} lineHeight="1em" lastLineWidth="45%" />
        <Skeleton className="skeleton-record-image" block />
        <SkeletonText lines={4} lineHeight="0.95em" lastLineWidth="55%" />
      </div>
    </SkeletonShell>
  );
}

/**
 * Skeleton for a comments tree. Mirrors the .comment layout (avatar +
 * byline + body) so the placeholder doesn't reflow once replies arrive.
 */
export function CommentsSkeleton({ rows = 3 }) {
  return (
    <SkeletonShell label="Loading replies">
      <ul className="skeleton-comments">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="skeleton-comments-item">
            <div className="skeleton-comments-head">
              <Skeleton className="skeleton-comments-avatar" />
              <Skeleton
                className="skeleton-comments-name"
                style={{ width: `${30 + ((i * 13) % 25)}%` }}
              />
            </div>
            <SkeletonText
              className="skeleton-comments-text"
              lines={1 + (i % 2)}
              lineHeight="0.95em"
              lastLineWidth={`${45 + ((i * 11) % 30)}%`}
            />
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Generic prose skeleton — used for the Sharing page (and any other
 * Markdown-only page in the future). Just stacked paragraph blocks.
 */
export function ProseSkeleton({ paragraphs = 3 }) {
  return (
    <SkeletonShell label="Loading">
      <div className="skeleton-record">
        {Array.from({ length: paragraphs }, (_, i) => (
          <SkeletonText
            key={i}
            lines={3 + (i % 2)}
            lineHeight="0.95em"
            lastLineWidth={`${45 + ((i * 13) % 30)}%`}
          />
        ))}
      </div>
    </SkeletonShell>
  );
}
