import { Rows2, Table2 } from 'lucide-react';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import './LayoutToggle.css';

const LABELS = {
  default: 'Feed layout: default',
  ledger: 'Feed layout: ledger',
};

const GLYPHS = {
  default: Rows2,
  ledger: Table2,
};

/**
 * Two-way switch for the home feed's layout: `default` keeps the full
 * card treatment, `ledger` swaps in the condensed multi-column
 * typographic view (see FeedLedgerRow.jsx).
 */
export default function LayoutToggle() {
  const { layout, setLayout, options } = useFeedLayout();
  return (
    <div className="layout-toggle-options" role="group" aria-label="Home feed layout">
      {options.map((opt) => {
        const Glyph = GLYPHS[opt];
        return (
          <button
            key={opt}
            type="button"
            className={`layout-toggle-option ${layout === opt ? 'is-active' : ''}`}
            onClick={() => setLayout(opt)}
            aria-pressed={layout === opt}
            aria-label={LABELS[opt]}
            title={LABELS[opt]}
          >
            <Glyph className="layout-toggle-glyph" aria-hidden="true" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
