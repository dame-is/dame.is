import { useTypeface } from '../hooks/useTypeface.jsx';
import './TypefaceToggle.css';

const LABELS = {
  serif: 'Crimson Pro (serif)',
  sans: 'Atkinson Hyperlegible (sans)',
  combo: 'Serif + Sans',
};

const GLYPHS = {
  serif: 'Aa',
  sans: 'Aa',
  combo: 'Aa',
};

export default function TypefaceToggle() {
  const { typeface, setTypeface, options } = useTypeface();
  return (
    <div className="typeface-toggle-options" role="group" aria-label="Typeface">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`typeface-toggle-option typeface-toggle-${opt} ${typeface === opt ? 'is-active' : ''}`}
          onClick={() => setTypeface(opt)}
          aria-pressed={typeface === opt}
          aria-label={LABELS[opt]}
          title={LABELS[opt]}
        >
          <span aria-hidden="true">{GLYPHS[opt]}</span>
        </button>
      ))}
    </div>
  );
}
