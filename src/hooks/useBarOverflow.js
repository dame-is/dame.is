import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The bottom bar's priority order: what gives way, first to last, when the
 * row is wider than the screen. The compass is not on the list. It never
 * shrinks and never leaves, because it is the way to the rest of the site.
 *
 * - `words`: the small-caps word in each chip on a wide desktop, and the
 *   first-visit captions under them on a phone. They go before any tool does.
 * - `home`: the wordmark in the top bar already goes home.
 * - `info`: the ⓘ sheet. Its key is still one tap away in the compass sheet.
 * - `day`: the day in view beside ↑. A signal, not a tool.
 * - `back`, then the page's own tools, then ↑ itself.
 * - With the menu open the bar wears the menu's own controls: Account, then
 *   the feed layout in words, give way last.
 * - The hour chip, last of all.
 *
 * A chip that leaves the bar is drawn at the foot of the compass sheet with
 * its word (ActionDock), so nothing is lost, only moved.
 */
export const BAR_PRIORITY = [
  'words',
  'home',
  'info',
  'day',
  'back',
  'print',
  'search',
  'filter',
  'edit',
  'inspect',
  'scroll',
  'account',
  'layout',
  'sky',
];

// Anything measured below this much over the row's width is rounding (widths
// are read as whole layout pixels; see useBarOverflow).
const SLACK = 1;

/**
 * Which chips leave the bar, given what the row needs with everything in it
 * and what it has. Pure, so it can be tested without a layout.
 *
 * `items` describes every chip on the bar right now, shown or hidden, keyed
 * as in BAR_PRIORITY: `{ key, width, extra, gap, shown }`. `width` is the
 * chip without its word, `extra` what the word adds, `gap` the gap it brings
 * with it. A hidden chip's sizes are the last ones measured.
 *
 * `natural` is what the row's visible content takes now; `wordsShown` and
 * `dayShown` say whether the words and the day are in that figure. `forced`
 * are keys that are out of the bar whatever the room (Home on a phone).
 *
 * Returns `{ hidden, words, day }`.
 */
export function planBarOverflow({
  box,
  natural,
  items,
  wordsWanted,
  wordsShown,
  dayWidth = 0,
  dayShown = false,
  forced = [],
  priority = BAR_PRIORITY,
}) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const forcedSet = new Set(forced);
  // What the row would need with every chip back, every word and the day.
  let full = natural;
  for (const it of items) {
    if (forcedSet.has(it.key)) continue;
    if (!it.shown) full += it.width + it.gap + (wordsWanted ? it.extra : 0);
    else if (wordsWanted && !wordsShown) full += it.extra;
  }
  if (!dayShown && dayWidth > 0) full += dayWidth;

  const hidden = [...forcedSet].filter((k) => byKey.has(k));
  const out = new Set(hidden);
  let words = wordsWanted;
  // The day stays allowed unless it is actually taken out; with no day on
  // the bar there's nothing to plan for it.
  let day = true;
  for (const key of priority) {
    if (full <= box + SLACK) break;
    if (key === 'words') {
      if (!words) continue;
      for (const it of items) if (!out.has(it.key)) full -= it.extra;
      words = false;
    } else if (key === 'day') {
      if (!day || dayWidth <= 0) continue;
      full -= dayWidth;
      day = false;
    } else {
      const it = byKey.get(key);
      if (!it || out.has(key)) continue;
      full -= it.width + it.gap + (words ? it.extra : 0);
      out.add(key);
      hidden.push(key);
    }
  }
  return { hidden, words, day };
}

const REM_FALLBACK = 16;

/**
 * Keeps the bottom bar's row inside the screen. After every render, and
 * whenever the row or a chip changes size (a rotation, larger text, a font
 * landing, the day beside ↑ changing), it measures the row and its
 * `[data-tool]` chips and plans what leaves (planBarOverflow). Measuring in a
 * layout effect means a chip that would overflow is moved out before the
 * frame paints.
 *
 * It never reads layout on scroll. A chip's sizes are remembered while it's
 * hidden, so the plan can tell when there's room for it to come back.
 *
 * Sizes are layout widths (offsetWidth), not rects: the bar's right-hand
 * chips carry Motion's `layout` animation, which slides and scales them with
 * transforms, and a rect read mid-animation measured a chip at a fraction of
 * its width and left the compass off the screen.
 *
 * `mode` names the layout the words are drawn in ('row' beside the glyph on
 * a desktop, 'column' as captions under it), since a word costs a different
 * amount in each. Returns `{ hidden: Set, words, day }`.
 */
export function useBarOverflow(rowRef, { wordsWanted, mode, forced, dayPresent = false, enabled = true }) {
  const [plan, setPlan] = useState(() => ({ hidden: new Set(forced), words: wordsWanted, day: true }));
  const sizesRef = useRef(new Map());
  const planRef = useRef(plan);
  planRef.current = plan;
  const argsRef = useRef(null);
  argsRef.current = { wordsWanted, mode, forced, enabled, dayPresent };
  const measureRef = useRef(null);

  if (!measureRef.current) {
    measureRef.current = () => {
      const row = rowRef.current;
      const args = argsRef.current;
      if (!row || !args.enabled) return;
      const rowStyle = getComputedStyle(row);
      const box =
        row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
      if (!(box > 0)) return;
      const rowGap = parseFloat(rowStyle.columnGap) || 0;
      let natural = 0;
      let count = 0;
      for (const el of row.children) {
        const s = getComputedStyle(el);
        // Motion's popLayout takes a leaving chip out of flow while it fades.
        if (s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue;
        count += 1;
        // The spacer is slack, not need: it only brings its gaps.
        if (!el.classList.contains('chrome-bottom-spacer')) natural += el.offsetWidth;
      }
      natural += rowGap * Math.max(0, count - 1);

      const current = planRef.current;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || REM_FALLBACK;
      const sizes = sizesRef.current;
      const items = [];
      let dayWidth = 0;
      let dayMeasured = false;
      for (const el of row.querySelectorAll('[data-tool]')) {
        const key = el.dataset.tool;
        const known = sizes.get(key) || { width: 1.75 * rem, gap: rowGap, extra: {} };
        const visible = getComputedStyle(el).display !== 'none';
        if (visible) {
          const face = el.querySelector('.chrome-nav-face') || el;
          const chipW = el.offsetWidth;
          let faceW = face.offsetWidth;
          const daySpan = key === 'scroll' ? el.querySelector('.chrome-scroll-day') : null;
          if (daySpan) {
            const faceGap = parseFloat(getComputedStyle(face).columnGap) || 0;
            dayWidth = daySpan.offsetWidth + faceGap;
            dayMeasured = true;
            faceW -= dayWidth;
          } else if (key === 'scroll' && args.dayPresent) {
            // The day is wanted but planned out: its last measured width.
            dayWidth = known.day || 0;
          }
          known.width = faceW;
          known.gap = parseFloat(getComputedStyle(el.parentElement).columnGap) || rowGap;
          if (current.words && args.wordsWanted) {
            known.extra = { ...known.extra, [args.mode]: Math.max(0, chipW - faceW - (daySpan ? dayWidth : 0)) };
          }
          sizes.set(key, known);
        } else if (key === 'scroll' && args.dayPresent) {
          dayWidth = known.day || 0;
        }
        if (key === 'scroll' && dayWidth) known.day = dayWidth;
        items.push({
          key,
          width: known.width,
          gap: known.gap,
          extra: known.extra[args.mode] || 0,
          shown: visible,
        });
      }
      const next = planBarOverflow({
        box,
        natural,
        items,
        wordsWanted: args.wordsWanted,
        wordsShown: current.words && args.wordsWanted,
        dayWidth: args.dayPresent ? dayWidth : 0,
        dayShown: dayMeasured,
        forced: args.forced,
      });
      const nextHidden = new Set(next.hidden);
      const same =
        next.words === current.words &&
        next.day === current.day &&
        nextHidden.size === current.hidden.size &&
        [...nextHidden].every((k) => current.hidden.has(k));
      if (!same) setPlan({ hidden: nextHidden, words: next.words, day: next.day });
    };
  }

  // After every render: chips come and go with the page and the dock.
  useLayoutEffect(() => {
    measureRef.current();
  });

  // …and whenever something changes size without a render.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureRef.current());
    });
    ro.observe(row);
    const watched = new Set();
    const sync = () => {
      for (const el of row.querySelectorAll('[data-tool]')) {
        if (!watched.has(el)) {
          watched.add(el);
          ro.observe(el);
        }
      }
    };
    sync();
    // Chips mount and unmount with the page; pick up the new ones.
    const mo = new MutationObserver(sync);
    mo.observe(row, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, [rowRef]);

  return plan;
}
