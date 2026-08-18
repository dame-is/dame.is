import { ChevronUp, ChevronDown, X } from 'lucide-react';

/**
 * The primitives every repeatable admin field is built from — reorder, replace,
 * remove, and the ▲ / ▼ / ✕ cluster that drives them.
 *
 * These lived in resumeFields.jsx, which is where the first list editors were
 * written. They are here because they are not about resumes: the profile's
 * photo gallery wants the same row affordances, and importing them from a
 * module named for another lexicon would have made that a coincidence rather
 * than a shared control. The `rf-` class names are kept verbatim — they are
 * styled once in Admin.css and every existing list row already wears them.
 */

export function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function replaceAt(arr, index, item) {
  const next = arr.slice();
  next[index] = item;
  return next;
}

export function removeAt(arr, index) {
  const next = arr.slice();
  next.splice(index, 1);
  return next;
}

/** Small ▲ / ▼ / ✕ control cluster shared by every list row. */
export function RowControls({ index, length, onMove, onRemove, removeLabel = 'Remove' }) {
  return (
    <div className="rf-controls">
      <button
        type="button"
        className="rf-icon-btn"
        onClick={() => onMove(index, index - 1)}
        disabled={index === 0}
        aria-label="Move up"
        title="Move up"
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rf-icon-btn"
        onClick={() => onMove(index, index + 1)}
        disabled={index === length - 1}
        aria-label="Move down"
        title="Move down"
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rf-icon-btn rf-icon-btn-danger"
        onClick={() => onRemove(index)}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
