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
 */
export default function SkyHourSheet() {
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
          className="sky-hour-sheet-step"
          onClick={() => setSkyHour((skyHour + 23) % 24)}
          aria-label="Previous hour"
          title="Previous hour"
        >
          <ArrowLeft size={14} aria-hidden="true" strokeWidth={1.75} />
        </button>
        <div className="sky-hour-sheet-arc" role="tablist" aria-label="Hour">
          {Array.from({ length: 24 }, (_, h) => {
            const pv = paletteForHour(h).vars['--sky-page'];
            return (
              <button
                key={h}
                type="button"
                role="tab"
                aria-selected={h === skyHour}
                className={`sky-hour-sheet-cell ${h === skyHour ? 'is-sel' : ''}`}
                style={{ background: pv }}
                title={skyHourKey(h)}
                onClick={() => setSkyHour(h)}
              >
                <span className="sky-hour-sheet-cell-label">{skyHourKey(h)}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="sky-hour-sheet-step"
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
