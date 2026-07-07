import { AlignJustify, Grip, Square } from 'lucide-react';
import { usePaper } from '../hooks/usePaper.jsx';

// Per-mode glyph + label for the cycling paper-texture button.
//   blank → empty square, ruled → horizontal lines, dots → dot grid.
const PAPER = {
  blank: { Icon: Square, label: 'blank page' },
  ruled: { Icon: AlignJustify, label: 'ruled lines' },
  dots: { Icon: Grip, label: 'dot grid' },
};

const NEXT_LABEL = {
  blank: 'ruled lines',
  ruled: 'dot grid',
  dots: 'blank page',
};

export default function PaperToggle() {
  const { paper, cycle } = usePaper();
  const { Icon, label } = PAPER[paper] || PAPER.blank;
  return (
    <button
      type="button"
      className="chrome-nav chrome-paper-toggle"
      onClick={cycle}
      aria-label={`Paper: ${label} — tap for ${NEXT_LABEL[paper] || 'blank page'}`}
      title={`Paper: ${label} — tap to switch`}
    >
      <Icon className="chrome-nav-glyph" aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
}
