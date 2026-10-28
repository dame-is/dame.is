import { memo, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { SKY_BANDS, easternHour, skyHourLabel } from '../lib/skyTheme.js';
import './SkyHourSheet.css';

const TICKS = [
  [0, '12a'],
  [6, '6a'],
  [12, '12p'],
  [18, '6p'],
];

/**
 * The sky-hour picker — a 24-hour ribbon that expands up out of the bottom
 * chrome bar's hour chip, letting any visitor sample the site's palette at
 * any hour of the day. Choosing an hour holds the sky there; "Return to
 * live" clears the hold and goes back to the real Eastern clock. Same
 * BottomSheet mechanism as search / filter / info, so it coordinates with
 * the other panels (one at a time) and folds the nav dock away.
 *
 * The ribbon is one slider, not 24 tabs: a 44px press-and-drag target with
 * an ink thumb that names its hour, so a thumb can sweep the day instead of
 * hunting 10px cells. It is painted from SKY_BANDS, the avatar's own sky,
 * which is not quite the page you get (noon is cyan in the strip and near
 * white on screen), but it is the only way every hour keeps a visible edge.
 *
 * Distinct from the admin SkyThemeStudio's own hour bar: that one carries
 * the prev/next row + "X/24 tuned" meta and drives a live tuning preview;
 * this one is for non-admin exploration.
 *
 * Memoised, because the bottom bar that renders this re-renders as the page
 * scrolls. The sheet only renders its children while it's open, so closed,
 * none of the ribbon's work runs.
 */
function SkyHourSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'sky';
  const { skyHour, setSkyHour, skyOverridden } = useTheme();
  const ribbonRef = useRef(null);
  const dragging = useRef(false);
  const liveHour = easternHour();

  const hourAt = useCallback((clientX) => {
    const r = ribbonRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return Math.min(23, Math.max(0, Math.floor(((clientX - r.left) / r.width) * 24)));
  }, []);

  const pick = useCallback(
    (h) => {
      if (h == null || h === skyHour) return;
      setSkyHour(h);
    },
    [skyHour, setSkyHour],
  );

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    pick(hourAt(e.clientX));
  };
  const onPointerMove = (e) => {
    if (dragging.current) pick(hourAt(e.clientX));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKeyDown = (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -6, PageUp: 6 }[e.key];
    if (step != null) {
      e.preventDefault();
      setSkyHour((skyHour + step + 24) % 24);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setSkyHour(e.key === 'Home' ? 0 : 23);
    }
  };

  const pct = (h) => `${((h + 0.5) / 24) * 100}%`;

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      title="Time of day"
      id="chrome-sky-sheet"
      size="compact"
      className="sky-hour-sheet-panel"
      bodyClassName="sky-hour-sheet-content"
      // Live and held read differently, so the state survives a glance: live
      // is an accent square and the hour; held names the hour it's holding,
      // and the way back is a real button beside the ×.
      meta={
        skyOverridden ? (
          <span className="sky-hour-sheet-state is-held">Held at {skyHourLabel(skyHour)}</span>
        ) : (
          <span className="sky-hour-sheet-state">
            <span className="sky-hour-sheet-live-dot" aria-hidden="true" />
            Live · {skyHourLabel(skyHour)}
          </span>
        )
      }
      actions={
        skyOverridden ? (
          <button type="button" className="btn btn--sm sky-hour-sheet-live" onClick={() => setSkyHour(null)}>
            Return to live
          </button>
        ) : null
      }
    >
      <div className="sky-hour-sheet-arc-row">
        <button
          type="button"
          className="sky-hour-sheet-step sky-hour-sheet-step-prev"
          onClick={() => setSkyHour((skyHour + 23) % 24)}
          aria-label="Previous hour"
          title="Previous hour"
        >
          <ArrowLeft size={16} aria-hidden="true" strokeWidth={1.75} />
        </button>
        <div className="sky-hour-sheet-track">
          <div
            ref={ribbonRef}
            className="sky-hour-sheet-arc"
            role="slider"
            tabIndex={0}
            aria-label="Hour of the sky"
            aria-valuemin={0}
            aria-valuemax={23}
            aria-valuenow={skyHour}
            aria-valuetext={`${skyHourLabel(skyHour)}${skyOverridden ? ', held' : ', live'}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          >
            {SKY_BANDS.map(({ top, bottom }, h) => (
              <span
                key={h}
                className="sky-hour-sheet-cell"
                style={{ background: `linear-gradient(to bottom, ${top}, ${bottom})` }}
                aria-hidden="true"
              />
            ))}
            <span className="sky-hour-sheet-thumb" style={{ left: pct(skyHour) }} aria-hidden="true">
              <span className="sky-hour-sheet-thumb-tag">{skyHourLabel(skyHour)}</span>
            </span>
          </div>
          <div className="sky-hour-sheet-scale" aria-hidden="true">
            {TICKS.map(([h, label]) => (
              <span key={h} className="sky-hour-sheet-tick" style={{ left: pct(h) }}>
                {label}
              </span>
            ))}
            <span className="sky-hour-sheet-now" style={{ left: pct(liveHour) }}>
              now
            </span>
          </div>
        </div>
        <button
          type="button"
          className="sky-hour-sheet-step sky-hour-sheet-step-next"
          onClick={() => setSkyHour((skyHour + 1) % 24)}
          aria-label="Next hour"
          title="Next hour"
        >
          <ArrowRight size={16} aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>
    </BottomSheet>
  );
}

export default memo(SkyHourSheet);
