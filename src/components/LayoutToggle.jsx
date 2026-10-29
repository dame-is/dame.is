import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import './LayoutToggle.css';

/**
 * The feeds that read the shared layout setting (useFeedLayout): the bottom
 * bar draws this control, with the menu open, only on these. Elsewhere it
 * would be a switch that visibly does nothing.
 */
export const FEED_LAYOUT_PATHS = ['/', '/posting', '/logging', '/listening', '/blogging'];

const WORDS = {
  ledger: 'ledger',
  cards: 'cards',
};

const TITLES = {
  ledger: 'Ledger: one line per entry, in columns',
  cards: 'Cards: each entry in full',
};

/**
 * The feeds' layout as its two choices, "ledger · cards", the current one in
 * the bar's "on" look (the accent wash and hairline the open chips wear)
 * rather than a near-black square that out-shouted the compass. No "layout:"
 * label beside them: the bar's chips carry no words, and the two options name
 * themselves; the group's accessible name says what they choose. `ledger`
 * (the default) is the condensed multi-column view (FeedLedgerRow.jsx),
 * `cards` the full card treatment.
 */
export default function LayoutToggle() {
  const { layout, setLayout, options } = useFeedLayout();
  return (
    <div className="layout-toggle" role="group" aria-label="Feed layout">
      {options.map((opt, i) => (
        <span key={opt} className="layout-toggle-item">
          {i > 0 && (
            <span className="layout-toggle-sep" aria-hidden="true">
              ·
            </span>
          )}
          <button
            type="button"
            className={`layout-toggle-option ${layout === opt ? 'is-active' : ''}`}
            onClick={() => setLayout(opt)}
            aria-pressed={layout === opt}
            title={TITLES[opt]}
          >
            {WORDS[opt]}
          </button>
        </span>
      ))}
    </div>
  );
}
