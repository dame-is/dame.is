import { useEffect } from 'react';
import { rhythmPads, rhythmPhase } from '../lib/lineRhythm.js';

// A block that hangs from the one above instead of starting on the rhythm.
const HUNG = '.leaflet-credit';
// Blocks whose first line sits on the rhythm, not their box: a part's head
// has its rule and a little space above the line (LeafletDocument.css).
const LINE_INSIDE = '.leaflet-heading';

// One line box of the document's text as the browser draws it, and the
// baseline's depth in it, which is where the drawn rule goes (grid.css). The
// line is measured rather than read from the stylesheet because a line that
// isn't a whole pixel is rounded to the layout's own unit, and the depth
// because it depends on the face's ascent and descent. Kept once the fonts
// have loaded.
const metrics = new Map();

function lineMetrics(cs) {
  const key = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily} ${cs.lineHeight}`;
  if (metrics.has(key)) return metrics.get(key);
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    visibility: 'hidden',
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight,
  });
  const mark = document.createElement('span');
  Object.assign(mark.style, { display: 'inline-block', width: '0', height: '0' });
  probe.append(mark, 'x');
  document.body.append(probe);
  const box = probe.getBoundingClientRect();
  const found = { line: box.height, depth: mark.getBoundingClientRect().top - box.top };
  probe.remove();
  if (document.fonts?.status === 'loaded') metrics.set(key, found);
  return found;
}

/** Measure the document's blocks and write the pads and the rule's phase. All
 *  the reads come before any write, so it costs one layout. */
function settle(doc) {
  const cs = getComputedStyle(doc);
  // Not on screen (print), or the rhythm's stylesheet isn't in.
  if (cs.display !== 'flex') return;
  const { line, depth: baseline } = lineMetrics(cs);
  if (!(line > 0)) return;
  const blocks = [];
  for (const el of doc.children) {
    if (el.getClientRects().length === 0) continue;
    const { position } = getComputedStyle(el);
    if (position === 'absolute' || position === 'fixed') continue;
    blocks.push(el);
  }
  if (blocks.length === 0) return;
  const docTop = doc.getBoundingClientRect().top;
  const tops = blocks.map((el) => {
    const top = el.getBoundingClientRect().top - docTop;
    if (!el.matches(LINE_INSIDE)) return top;
    const s = getComputedStyle(el);
    return top + parseFloat(s.borderTopWidth) + parseFloat(s.paddingTop);
  });
  const pads = blocks.map((el) => parseFloat(el.style.getPropertyValue('--rhythm-pad')) || 0);
  const next = rhythmPads(tops, pads, line, blocks.map((el) => !el.matches(HUNG)));
  next.forEach((pad, i) => {
    if (Math.abs(pad - pads[i]) < 0.01) return;
    if (pad) blocks[i].style.setProperty('--rhythm-pad', `${pad}px`);
    else blocks[i].style.removeProperty('--rhythm-pad');
  });
  // The line, at full precision: it is the layout's own unit, and rounding it
  // would bring back the drift it is measured to prevent. The baseline's
  // depth is the face's alone; the phase also counts where the first line
  // starts. A part's rule is placed by the first, so it can't feed back into
  // the second when a document opens on a part.
  doc.style.setProperty('--rhythm-line', `${line}px`);
  doc.style.setProperty('--rhythm-baseline', `${Math.round(baseline * 100) / 100}px`);
  doc.style.setProperty('--rhythm-phase', `${rhythmPhase(tops[0], baseline, line)}px`);
}

/**
 * Keeps a LeafletDocument on its line rhythm (LeafletDocument.css): after
 * anything whose height is its own (a picture, an embed, a chart), the next
 * block takes the pad that brings its first line back onto the rhythm.
 *
 * Settles on mount and again whenever the document changes size: a picture
 * loading, an embed arriving, the window narrowing and the text rewrapping,
 * the fonts landing. Each run is one frame later, and a run that changes
 * nothing changes no size, so it never loops. `ready` is false while the
 * document has nothing to draw, and the hook waits for it.
 */
export default function useLineRhythm(ref, ready = true) {
  useEffect(() => {
    const doc = ref.current;
    if (!ready || !doc || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    let live = true;
    const run = () => {
      frame = 0;
      settle(doc);
    };
    const schedule = () => {
      if (live && !frame) frame = requestAnimationFrame(run);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(doc);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      live = false;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, ready]);
}
