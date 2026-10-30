import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { smartenText } from '../lib/smartPunctuation.js';
import './ReadingMarker.css';

/**
 * Where a reader is in a document, kept in the note column beside it: the
 * section they're in, a rule that fills as they read with a tick where each
 * section starts, and how long the rest will take. It rides down the page
 * with them (sticky) and steps aside for a chart or a gallery that's wide
 * enough to cross the column.
 *
 * On a phone there's no note column, so it's only the rule, a hairline under
 * the running head while the document is on screen. That one is portalled to
 * <body>: the article it belongs to keeps a transform from its entrance
 * (.reveal), which would hold a fixed child to the article instead of the
 * window (ReadingMarker.css).
 *
 * It finds its document itself: the `.leaflet-doc` in the same `.doc-body`
 * (BlogPost.jsx, CreatingWork.jsx). `minutes` is the whole document's reading
 * time (lib/readingTime.js); the time left is its share of what's still
 * below the reading line. Decorative for a screen reader, which has the
 * reading time in the facts above it and the document's own headings.
 */
export default function ReadingMarker({ minutes = 0 }) {
  const ref = useRef(null);
  const barRef = useRef(null);
  const [sections, setSections] = useState([]);
  const [at, setAt] = useState({
    index: -1,
    left: minutes,
    covered: false,
    active: false,
    done: false,
  });

  useEffect(() => {
    const marker = ref.current;
    const doc = marker?.closest('.doc-body')?.querySelector('.leaflet-doc');
    if (!marker || !doc) return undefined;

    let heads = [];
    let wide = [];
    let frame = 0;

    // The document's sections: its headings at the highest level that occurs
    // at least twice, so a lone heading over the whole piece isn't a section
    // and subheads stay inside the section they belong to.
    const collect = () => {
      const all = [...doc.querySelectorAll('.leaflet-heading')].filter((h) =>
        h.textContent.trim(),
      );
      const counts = new Map();
      for (const h of all)
        counts.set(h.tagName, (counts.get(h.tagName) || 0) + 1);
      const level = [...counts.keys()]
        .sort()
        .find((tag) => counts.get(tag) >= 2);
      heads = level ? all.filter((h) => h.tagName === level) : [];
      const top = doc.getBoundingClientRect().top;
      const height = doc.offsetHeight || 1;
      setSections(
        heads.map((h, i) => ({
          key: h.id || String(i),
          number: h.dataset.section || String(i + 1),
          title: smartenText(
            [...h.childNodes]
              .filter(
                (n) =>
                  !(
                    n.nodeType === 1 &&
                    n.classList.contains('leaflet-section-num')
                  ),
              )
              .map((n) => n.textContent)
              .join('')
              .trim(),
          ),
          at: Math.min(
            1,
            Math.max(0, (h.getBoundingClientRect().top - top) / height),
          ),
        })),
      );
      // Whatever in the document reaches left past the text column into the
      // note column: a chart, a gallery, a section head set over them, a
      // picture hung wide. A chart widens from inside its figure, so the
      // blocks' own children are asked too.
      const textLeft = doc.getBoundingClientRect().left;
      wide = [...doc.querySelectorAll(':scope > *, :scope > * > *')].filter(
        (c) => c.getBoundingClientRect().left < textLeft - 4,
      );
    };

    const update = () => {
      frame = 0;
      const r = doc.getBoundingClientRect();
      const view = window.innerHeight;
      // The reading line: two-fifths down the window, about where an eye rests.
      const line = view * 0.4;
      const progress = Math.min(
        1,
        Math.max(0, (line - r.top) / (r.height || 1)),
      );
      marker.style.setProperty('--progress', progress.toFixed(4));
      barRef.current?.style.setProperty('--progress', progress.toFixed(4));
      let index = -1;
      for (let i = 0; i < heads.length; i += 1) {
        if (heads[i].getBoundingClientRect().top <= line) index = i;
      }
      const m = marker.getBoundingClientRect();
      const covered =
        m.height > 0 &&
        wide.some((w) => {
          const b = w.getBoundingClientRect();
          return b.bottom > m.top - 8 && b.top < m.bottom + 8;
        });
      const active = r.top < view && r.bottom > 0;
      const done = progress >= 0.995;
      const left = Math.ceil(minutes * (1 - progress));
      setAt((s) =>
        s.index === index &&
        s.covered === covered &&
        s.active === active &&
        s.done === done &&
        s.left === left
          ? s
          : { index, covered, active, done, left },
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const refresh = () => {
      collect();
      schedule();
    };

    refresh();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', refresh);
    // Pictures and embeds load after the text and move every heading down;
    // so do x-ray's notes and a gallery opening up.
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(refresh)
        : null;
    ro?.observe(doc);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', refresh);
      ro?.disconnect();
    };
  }, [minutes]);

  const current = at.index >= 0 ? sections[at.index] : null;
  const leftLabel = at.done
    ? 'the end'
    : at.left <= 1
      ? minutes > 1 || at.index >= 0
        ? 'a minute left'
        : `${minutes || 1} min read`
      : `${at.left} min left`;

  return (
    <>
      <div
        ref={ref}
        className={`reading-marker${at.covered ? ' is-covered' : ''}${at.active ? ' is-active' : ''}${at.done ? ' is-done' : ''}`}
        aria-hidden="true"
      >
        {sections.length > 0 && (
          <div className="reading-marker-where">
            {current ? (
              <p key={current.key} className="reading-marker-section">
                <span className="reading-marker-count">
                  <span className="reading-marker-num">{current.number}</span>
                  <span className="reading-marker-of">
                    {' '}
                    of {sections.length}
                  </span>
                </span>
                <span className="reading-marker-title">{current.title}</span>
              </p>
            ) : (
              <p
                key="before"
                className="reading-marker-section reading-marker-before"
              >
                <span className="reading-marker-count">
                  <span className="reading-marker-of">
                    {sections.length} sections
                  </span>
                </span>
              </p>
            )}
          </div>
        )}
        <div className="reading-marker-rule">
          <span className="reading-marker-fill" />
          {sections.map((s, i) => (
            <span
              key={s.key}
              className={`reading-marker-tick${i <= at.index ? ' is-passed' : ''}`}
              style={{ left: `${(s.at * 100).toFixed(2)}%` }}
            />
          ))}
        </div>
        <p className="reading-marker-left">{leftLabel}</p>
      </div>
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={barRef}
            className={`reading-progress${at.active ? ' is-active' : ''}`}
            aria-hidden="true"
          >
            <span className="reading-marker-fill" />
          </div>,
          document.body,
        )}
    </>
  );
}
