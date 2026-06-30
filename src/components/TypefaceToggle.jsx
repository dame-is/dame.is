import { useTypeface } from '../hooks/useTypeface.jsx';
import './DensityToggle.css';

const LABELS = {
  combo: 'Typeface: serif + sans (default)',
  serif: 'Typeface: serif only',
  sans: 'Typeface: sans only',
};

// Each option previews itself: the "Aa" renders in the family the
// option selects, so the button literally shows the typeface. "combo"
// mixes a serif "A" with a sans "a" to signal the default split.
// These reference the raw --font-* stacks (not --serif/--sans, which
// the data-typeface mode rewrites) so each preview stays fixed.
const GLYPHS = {
  combo: [
    { ch: 'A', family: 'var(--font-crimson)' },
    { ch: 'a', family: 'var(--font-atkinson)' },
  ],
  serif: [
    { ch: 'A', family: 'var(--font-crimson)' },
    { ch: 'a', family: 'var(--font-crimson)' },
  ],
  sans: [
    { ch: 'A', family: 'var(--font-atkinson)' },
    { ch: 'a', family: 'var(--font-atkinson)' },
  ],
};

export default function TypefaceToggle() {
  const { typeface, setTypeface, options } = useTypeface();
  return (
    <div className="density-toggle-options" role="group" aria-label="Typeface">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`density-toggle-option ${typeface === opt ? 'is-active' : ''}`}
          onClick={() => setTypeface(opt)}
          aria-pressed={typeface === opt}
          aria-label={LABELS[opt]}
          title={LABELS[opt]}
        >
          <span className="typeface-toggle-glyph" aria-hidden="true">
            {GLYPHS[opt].map((g, i) => (
              <span key={i} style={{ fontFamily: g.family }}>
                {g.ch}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
