import { Rows2, Rows3, Rows4 } from 'lucide-react';
import { useDensity } from '../hooks/useDensity.jsx';
import './DensityToggle.css';

const LABELS = {
  normal: 'Density: normal',
  compact: 'Density: compact',
  tight: 'Density: tight',
};

const GLYPHS = {
  normal: Rows2,
  compact: Rows3,
  tight: Rows4,
};

export default function DensityToggle() {
  const { density, setDensity, options } = useDensity();
  return (
    <div className="density-toggle-options" role="group" aria-label="Density">
      {options.map((opt) => {
        const Glyph = GLYPHS[opt];
        return (
          <button
            key={opt}
            type="button"
            className={`density-toggle-option ${density === opt ? 'is-active' : ''}`}
            onClick={() => setDensity(opt)}
            aria-pressed={density === opt}
            aria-label={LABELS[opt]}
            title={LABELS[opt]}
          >
            <Glyph className="density-toggle-glyph" aria-hidden="true" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
