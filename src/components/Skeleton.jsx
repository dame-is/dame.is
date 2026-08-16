import { motion } from 'motion/react';
import './Skeleton.css';

/**
 * Animated loading skeletons for record-driven pages.
 *
 * Each `.skeleton` block is a flat parchment-midtone rectangle that
 * slowly breathes between two palette colors (`--rule-soft` and
 * `--rule`), with a small opacity pulse layered on top. No gradients —
 * the rest of the site is drawn in solid colors and hairline rules, so
 * the placeholders match that voice. Because the keyframe loop returns
 * to its starting color, the cycle has no visible seam.
 *
 * The outer `SkeletonShell` adds a short Motion fade-in (and fade-out
 * when wrapped in `AnimatePresence`) so the skeleton column doesn't
 * snap into or out of place when real content arrives.
 *
 * Multi-item skeletons (feed, TOC, grid, comments) are staggered via
 * CSS `:nth-child` animation-delays so rows breathe slightly out of
 * phase instead of pulsing in lockstep. The breathing respects
 * `prefers-reduced-motion` (CSS falls back to a static, slightly faded
 * block).
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
 * Skeleton for the Mothing page. Mirrors the real layout so nothing
 * reflows once the snapshot lands: a `.mothing-stats` row, then a couple
 * of session blocks — each a `.mothing-session-head` above a
 * `.mothing-grid` of 1:1 moth cards (thumb + name / sci / time meta).
 */
export function MothingSkeleton({ sessions = 2, cells = 4 }) {
  return (
    <SkeletonShell label="Loading moths">
      <div className="skeleton-mothing-stats">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-mothing-stat">
            <Skeleton
              className="skeleton-mothing-stat-value"
              style={{ width: i === 3 ? '9rem' : `${2.5 + ((i * 5) % 3)}rem` }}
            />
            <Skeleton className="skeleton-mothing-stat-label" />
          </div>
        ))}
      </div>
      <div className="skeleton-mothing-sessions">
        {Array.from({ length: sessions }, (_, s) => (
          <section key={s} className="skeleton-mothing-session">
            <div className="skeleton-mothing-head">
              <div className="skeleton-mothing-headrow">
                <Skeleton className="skeleton-mothing-num" />
                <Skeleton
                  className="skeleton-mothing-title"
                  style={{ width: `${9 + ((s * 4) % 5)}rem` }}
                />
              </div>
              <Skeleton className="skeleton-mothing-headstats" />
            </div>
            <ul className="skeleton-mothing-grid">
              {Array.from({ length: cells }, (_, i) => (
                <li key={i} className="skeleton-mothing-cell">
                  <Skeleton className="skeleton-mothing-thumb" />
                  <div className="skeleton-mothing-meta">
                    <Skeleton
                      className="skeleton-mothing-name"
                      style={{ width: `${55 + ((i * 9) % 30)}%` }}
                    />
                    <Skeleton
                      className="skeleton-mothing-sci"
                      style={{ width: `${40 + ((i * 7) % 25)}%` }}
                    />
                    <Skeleton className="skeleton-mothing-sub" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
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

/**
 * Skeleton for the "for hire" resume page (Resume.jsx). Mirrors the
 * `.resume` article — a header (title + headline + contact row), a summary
 * paragraph, and the Experience / Education / Skills sections — so the swap
 * to the real resume doesn't reflow. Experience orgs carry the same left
 * rule and role head (title beside a right-aligned date range) as the real
 * layout; skills lay out on the same label + chips grid.
 */
export function ResumeSkeleton({ orgs = 3, education = 1, skillGroups = 3 }) {
  return (
    <SkeletonShell label="Loading resume" className="skeleton-resume reveal">
      <header className="skeleton-resume-header">
        <Skeleton className="skeleton-resume-title" />
        <Skeleton className="skeleton-resume-headline" />
        <div className="skeleton-resume-contact">
          <Skeleton className="skeleton-resume-contact-item" style={{ width: '5rem' }} />
          <Skeleton className="skeleton-resume-contact-item" style={{ width: '9.5rem' }} />
          <Skeleton className="skeleton-resume-contact-item" style={{ width: '6.5rem' }} />
        </div>
      </header>

      <div className="skeleton-resume-summary">
        <SkeletonText lines={3} lineHeight="0.9em" lastLineWidth="52%" />
      </div>

      {/* Experience */}
      <section className="skeleton-resume-section">
        <div className="skeleton-resume-section-head">
          <Skeleton className="skeleton-resume-section-title" style={{ width: '6rem' }} />
        </div>
        <div className="skeleton-resume-orgs">
          {Array.from({ length: orgs }, (_, oi) => (
            <div key={oi} className="skeleton-resume-org">
              <Skeleton
                className="skeleton-resume-org-name"
                style={{ width: `${9 + ((oi * 5) % 6)}rem` }}
              />
              <div className="skeleton-resume-role">
                <div className="skeleton-resume-role-head">
                  <Skeleton
                    className="skeleton-resume-role-title"
                    style={{ width: `${8 + ((oi * 7) % 7)}rem` }}
                  />
                  <Skeleton className="skeleton-resume-role-dates" />
                </div>
                <Skeleton
                  className="skeleton-resume-role-meta"
                  style={{ width: `${10 + ((oi * 3) % 6)}rem` }}
                />
                <ul className="skeleton-resume-highlights">
                  {Array.from({ length: 2 + (oi % 2) }, (_, hi) => (
                    <li key={hi} className="skeleton-resume-highlight">
                      <Skeleton block style={{ width: `${72 + ((hi * 13) % 24)}%`, height: '0.85em' }} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Education */}
      <section className="skeleton-resume-section">
        <div className="skeleton-resume-section-head">
          <Skeleton className="skeleton-resume-section-title" style={{ width: '5.5rem' }} />
        </div>
        <div className="skeleton-resume-orgs">
          {Array.from({ length: education }, (_, ei) => (
            <div key={ei} className="skeleton-resume-role">
              <div className="skeleton-resume-role-head">
                <Skeleton
                  className="skeleton-resume-role-title"
                  style={{ width: `${10 + ((ei * 5) % 5)}rem` }}
                />
                <Skeleton className="skeleton-resume-role-dates" />
              </div>
              <Skeleton className="skeleton-resume-role-meta" style={{ width: '8rem' }} />
            </div>
          ))}
        </div>
      </section>

      {/* Skills */}
      <section className="skeleton-resume-section">
        <div className="skeleton-resume-section-head">
          <Skeleton className="skeleton-resume-section-title" style={{ width: '4rem' }} />
        </div>
        <div className="skeleton-resume-skills">
          {Array.from({ length: skillGroups }, (_, gi) => (
            <div key={gi} className="skeleton-resume-skill-group">
              <Skeleton
                className="skeleton-resume-skill-cat"
                style={{ width: `${5 + ((gi * 3) % 5)}rem` }}
              />
              <div className="skeleton-resume-skill-items">
                {Array.from({ length: 3 + (gi % 3) }, (_, si) => (
                  <Skeleton
                    key={si}
                    className="skeleton-resume-skill"
                    style={{ width: `${3 + ((si * 7) % 5)}rem` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </SkeletonShell>
  );
}

/* -------------------------------------------------------------------- */
/* Admin variants                                                        */
/* -------------------------------------------------------------------- */

/**
 * Skeleton for an admin record list. There are two real row shapes in the
 * admin now and a single placeholder cannot stand in for both, so the caller
 * says which one it is about to render:
 *
 *   `variant="classic"` (default) — the frozen `.admin-record-list` row: a
 *     fixed 14ch rkey column, then a flexible preview line, all on one line.
 *     Still what PagesOverview draws.
 *   `variant="workbench"` — the workbench list column's `.wb-list-row`: a
 *     checkbox gutter, then the record's name on its own line with the rkey
 *     and timestamp on a quieter line beneath it.
 *
 * Guessing wrong is not a cosmetic matter: the two shapes put their heaviest
 * block on opposite sides of the column, so a mismatched placeholder reads as
 * the list jumping sideways the instant the real rows arrive.
 *
 * `marker` is the workbench variant's one piece of caller knowledge: the real
 * row draws a small visibility square before the name, but only for the four
 * collections that have a visibility model at all (`hasState` in RecordRow).
 * Drawing it unconditionally would indent every title by 14px in the lists
 * that never show one; omitting it would under-indent the ones that do.
 *
 * Pass `toolbar` to prepend a `.admin-toolbar`-shaped bar, used when the
 * whole page is still resolving (e.g. the session-restore gate) and the
 * real toolbar hasn't rendered yet.
 */
export function AdminRecordListSkeleton({
  rows = 6,
  toolbar = false,
  variant = 'classic',
  marker = false,
  label = 'Loading records',
}) {
  const workbench = variant === 'workbench';
  return (
    <SkeletonShell label={label}>
      {toolbar && (
        <div className="skeleton-admin-toolbar">
          <Skeleton className="skeleton-admin-toolbar-back" />
          <Skeleton className="skeleton-admin-toolbar-nsid" />
          <Skeleton className="skeleton-admin-toolbar-btn" />
        </div>
      )}
      <ul className="skeleton-admin-list">
        {Array.from({ length: rows }, (_, i) =>
          workbench ? (
            <li key={i} className="skeleton-admin-row skeleton-admin-row-wb">
              {/* A real checkbox, hidden with `visibility` so it still occupies
                  its box. Two reasons it is not a plain <span> of a guessed
                  width: the browser's own checkbox metrics (13px plus 4px/3px
                  default margins) are what set the real gutter, and copying
                  them as a literal would silently drift; and the loaded row
                  keeps its checkbox at opacity 0 until you hover, focus or tick
                  it, so a breathing block here would advertise a control the
                  resolved list does not show. `disabled` and the negative
                  tabindex keep it out of the tab order. */}
              <input
                type="checkbox"
                className="skeleton-admin-gutter"
                disabled
                tabIndex={-1}
                aria-hidden="true"
                readOnly
              />
              {/* Heights are passed as props, not left to the stylesheet.
                  `Skeleton` writes its `height` default as an INLINE style, so
                  an inline rule always beats a `.skeleton-*` class and a height
                  declared in Skeleton.css silently does nothing. Widths are the
                  other way round — the `width` prop defaults to undefined, so
                  those do belong in the class. */}
              <span className="skeleton-admin-stack">
                <span className="skeleton-admin-line">
                  {marker && <Skeleton className="skeleton-admin-dot" height="0.4rem" />}
                  <Skeleton
                    className="skeleton-admin-label"
                    height="calc(var(--text-base) * var(--leading-tight))"
                    style={{ width: `${52 + ((i * 13) % 40)}%` }}
                  />
                </span>
                <span className="skeleton-admin-meta">
                  <Skeleton className="skeleton-admin-rkey-inline" height="1.35rem" />
                  <Skeleton className="skeleton-admin-when" height="1.2rem" />
                </span>
              </span>
            </li>
          ) : (
            <li key={i} className="skeleton-admin-row">
              {/* Heights as PROPS, for the reason spelled out in the workbench
                  branch above: `Skeleton` writes `height` as an inline style, so
                  a height in the stylesheet is silently dead. Both numbers are
                  the real row's measured line boxes — 1.35rem is the `<code>`
                  rkey chip's 21.6px, 1.6rem the `.admin-record-preview`'s 25.6px
                  — which is what brings the row from 36.2px to `.admin-record-
                  link`'s 45.8px. Every one of this variant's callers had a real
                  row TALLER than the placeholder (45.8 on Site pages, 39.4 on
                  Listening, 56.4 in the nav menu, 73.7 in the resume studio), so
                  the list shrank on every one of them as the data landed. */}
              <Skeleton className="skeleton-admin-rkey" height="1.35rem" />
              <Skeleton
                className="skeleton-admin-preview"
                height="1.6rem"
                /* 38–72% rather than 52–92%. With the flex-grow removed (see
                   Skeleton.css) this width is now what the bar actually gets,
                   and a bar that reaches the right edge promises a full-width
                   line of text where the real rows hold a short title with the
                   rest of the row empty — the play list's rows are a label at
                   the left and a small "Edit →" at the right with ~300px of
                   nothing between them. */
                style={{ width: `${38 + ((i * 13) % 34)}%` }}
              />
            </li>
          ),
        )}
      </ul>
    </SkeletonShell>
  );
}

/**
 * Skeleton for the Site-pages "Local vs PDS" grid. Mirrors the
 * `.admin-page-panel` cards — bordered blocks with a label + status badge,
 * a description line, and an actions row.
 */
export function AdminPagePanelsSkeleton({ panels = 4 }) {
  return (
    <SkeletonShell label="Loading pages">
      <div className="skeleton-admin-panels">
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className="skeleton-admin-panel">
            <div className="skeleton-admin-panel-head">
              <Skeleton
                className="skeleton-admin-panel-label"
                style={{ width: `${8 + ((i * 3) % 6)}rem` }}
              />
              <Skeleton className="skeleton-admin-panel-badge" />
            </div>
            <Skeleton
              className="skeleton-admin-panel-desc"
              style={{ width: `${60 + ((i * 11) % 30)}%` }}
            />
            <div className="skeleton-admin-panel-actions">
              <Skeleton className="skeleton-admin-panel-btn" />
              {i % 2 === 0 && (
                <Skeleton className="skeleton-admin-panel-btn" style={{ width: '6.5rem' }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

/**
 * Skeleton for the record editor form (RecordEditor while it fetches an
 * existing record). Mirrors the `.admin-form` stack — small-caps field
 * labels above inputs, one tall block for the body textarea, and an
 * actions row.
 *
 * `fields` is a count and gets the historical shape: every field a short input
 * except the last, which is drawn as a textarea. That is a GUESS, and it is
 * wrong whenever the lexicon has no long-text field at all — on an `is.dame.now`
 * record the placeholder draws two 40px inputs and a 136px block, then resolves
 * to three short fields and no textarea, so the form visibly collapses by ~96px
 * and everything under it jumps.
 *
 * `shapes` is the way out: pass an array of `'short'` / `'tall'`, one per field,
 * and the placeholder draws exactly the form that is coming. The caller is the
 * only one that can know — RecordEditor has the lexicon in hand at the call site
 * and can map its field types — so the knob is here and the knowledge stays
 * there. It is opt-in rather than the default because this component also
 * renders on public routes (the quick-edit sheet portals to <body>, and
 * /exploring draws the same form), where the loading state has to stay exactly
 * as it has always looked.
 */
export function AdminEditorSkeleton({ fields = 4, shapes = null }) {
  const rows = Array.isArray(shapes) && shapes.length ? shapes : null;
  const count = rows ? rows.length : fields;
  return (
    <SkeletonShell label="Loading record" className="skeleton-admin-form">
      {Array.from({ length: count }, (_, i) => {
        const tall = rows ? rows[i] === 'tall' : i === count - 1;
        return (
          <div key={i} className="skeleton-admin-field">
            <Skeleton
              className="skeleton-admin-field-label"
              style={{ width: `${4 + ((i * 5) % 5)}rem` }}
            />
            <Skeleton
              className={`skeleton-admin-field-input${tall ? ' skeleton-admin-field-input-tall' : ''}`}
            />
          </div>
        );
      })}
      <div className="skeleton-admin-actions">
        <Skeleton className="skeleton-admin-action-btn" />
        <Skeleton className="skeleton-admin-action-btn" style={{ width: '4.5rem' }} />
      </div>
    </SkeletonShell>
  );
}
