import { Rows3 } from 'lucide-react';
import { useCompact } from '../hooks/useCompact.jsx';
import './CompactToggle.css';

export default function CompactToggle() {
  const { compact, toggle } = useCompact();
  const label = compact ? 'Compact mode (on)' : 'Compact mode (off)';
  return (
    <button
      type="button"
      className={`compact-toggle ${compact ? 'is-active' : ''}`}
      onClick={toggle}
      aria-pressed={compact}
      aria-label={label}
      title={label}
    >
      <Rows3 className="compact-toggle-glyph" aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}
