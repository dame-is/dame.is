import { Aperture, CircleDashed } from 'lucide-react';
import { useFilmGrain } from '../hooks/useFilmGrain.jsx';
import './DensityToggle.css';

const LABELS = {
  on: 'Film grain: on',
  off: 'Film grain: off',
};

const GLYPHS = {
  on: Aperture,
  off: CircleDashed,
};

export default function FilmGrainToggle() {
  const { grain, setGrain, options } = useFilmGrain();
  return (
    <div className="density-toggle-options" role="group" aria-label="Film grain">
      {options.map((opt) => {
        const Glyph = GLYPHS[opt];
        return (
          <button
            key={opt}
            type="button"
            className={`density-toggle-option ${grain === opt ? 'is-active' : ''}`}
            onClick={() => setGrain(opt)}
            aria-pressed={grain === opt}
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
