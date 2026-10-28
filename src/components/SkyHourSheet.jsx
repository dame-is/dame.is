import { memo, useRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { paletteForHour, skyHourKey } from '../lib/skyTheme.js';
import './SkyHourSheet.css';

/**
 * The sky-hour picker — a 24-cell arc that expands up out of the bottom
 * chrome bar's hour chip, letting any visitor sample the site's palette at
 * any hour of the day. Tapping a cell freezes the sky on that hour; "Live"
 * clears the override and returns to the real Eastern clock. Same BottomSheet
 * mechanism as search / filter / info, so it coordinates with the other
 * panels (one at a time) and folds the nav dock away.
 *
 * Distinct from the admin SkyThemeStudio's own hour bar: that one carries
 * the prev/next row + "X/24 tuned" meta and drives a live tuning preview;
 * this one is just the arc, for non-admin exploration.
 *
 * Memoised, and the arc is its own component, because the bottom bar that
 * renders this re-renders as the page scrolls, and the arc works out all 24
 * palettes each time it renders. The sheet only renders its children while
 * it's open, so closed, none of that runs.
 */
function SkyHourSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'sky';
  const { skyHour, setSkyHour, skyOverridden } = useTheme();

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      label="Time of day"
      id="chrome-sky-sheet"
      size="compact"
      className="sky-hour-sheet-panel"
    >
      <div className="sky-hour-sheet-header">
        <span className="small-caps">Time of day</span>
        {skyOverridden ? (
          <button
            type="button"
            className="sky-hour-sheet-live"
            onClick={() => setSkyHour(null)}
            aria-label="Return to live clock"
            title="Return to live clock"
          >
            Live
          </button>
        ) : (
          <span className="sky-hour-sheet-live-label">Live</span>
        )}
      </div>
      <div className="sky-hour-sheet-arc-row">
        <button
          type="button"
          className="sky-hour-sheet-step sky-hour-sheet-step-prev"
          onClick={() => setSkyHour((skyHour + 23) % 24)}
          aria-label="Previous hour"
          title="Previous hour"
        >
          <ArrowLeft size={14} aria-hidden="true" strokeWidth={1.75} />
        </button>
        <SkyHourArc hour={skyHour} onPick={setSkyHour} />
        <button
          type="button"
          className="sky-hour-sheet-step sky-hour-sheet-step-next"
          onClick={() => setSkyHour((skyHour + 1) % 24)}
          aria-label="Next hour"
          title="Next hour"
        >
          <ArrowRight size={14} aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>
    </BottomSheet>
  );
}

export default memo(SkyHourSheet);

// Arrow keys step the arc the way they step any radio group; Home and End
// jump to midnight and 11pm.
const KEY_STEPS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

/**
 * The 24 cells, as a radio group: one Tab stop (the selected hour), arrow
 * keys to move. They were 24 `role="tab"` buttons controlling no tab panel,
 * which a screen reader announced as tabs, and which took 24 presses of Tab
 * to get past.
 *
 * On a phone each cell is a few pixels wide, too narrow to aim a finger at,
 * so a drag along the strip scrubs through the hours under it.
 */
function SkyHourArc({ hour, onPick }) {
  const cellsRef = useRef([]);
  const scrubRef = useRef(null);

  function hourAt(arc, clientX) {
    const r = arc.getBoundingClientRect();
    if (r.width <= 0) return hour;
    return Math.min(
      23,
      Math.max(0, Math.floor(((clientX - r.left) / r.width) * 24)),
    );
  }

  function pick(h) {
    if (h !== hour) onPick(h);
  }

  function onKeyDown(e) {
    let next = null;
    if (e.key in KEY_STEPS) next = (hour + KEY_STEPS[e.key] + 24) % 24;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 23;
    if (next == null) return;
    e.preventDefault();
    onPick(next);
    cellsRef.current[next]?.focus();
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    scrubRef.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pick(hourAt(e.currentTarget, e.clientX));
  }

  function onPointerMove(e) {
    if (scrubRef.current !== e.pointerId) return;
    pick(hourAt(e.currentTarget, e.clientX));
  }

  function endScrub(e) {
    if (scrubRef.current === e.pointerId) scrubRef.current = null;
  }

  return (
    <div
      className="sky-hour-sheet-arc"
      role="radiogroup"
      aria-label="Hour"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
    >
      {Array.from({ length: 24 }, (_, h) => {
        const pv = paletteForHour(h).vars['--sky-page'];
        const selected = h === hour;
        return (
          <button
            key={h}
            ref={(el) => {
              cellsRef.current[h] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={skyHourKey(h)}
            className={`sky-hour-sheet-cell ${selected ? 'is-sel' : ''}`}
            style={{ background: pv }}
            title={skyHourKey(h)}
            // Pointer presses already picked the hour on pointerdown; this is
            // the keyboard's Space and Enter.
            onClick={() => pick(h)}
          />
        );
      })}
    </div>
  );
}
