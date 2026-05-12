import { useTheme } from '../hooks/useTheme.jsx';
import './ThemeToggle.css';

const LABELS = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const GLYPHS = {
  light: '◐',
  dark: '◑',
  system: '◓',
};

export default function ThemeToggle() {
  const { theme, setTheme, options } = useTheme();
  return (
    <div className="dock-tool theme-toggle" role="group" aria-label="Theme">
      <span className="dock-tool-label">Theme</span>
      <span className="theme-toggle-options">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`theme-toggle-option ${theme === opt ? 'is-active' : ''}`}
            onClick={() => setTheme(opt)}
            aria-pressed={theme === opt}
            aria-label={LABELS[opt]}
            title={LABELS[opt]}
          >
            <span aria-hidden="true">{GLYPHS[opt]}</span>
          </button>
        ))}
      </span>
    </div>
  );
}
