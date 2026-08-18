import { Plus } from 'lucide-react';
import { move, replaceAt, removeAt, RowControls } from './listFields.jsx';

/**
 * Editor for a plain `[{ label, url }]` list — the profile record's `links`.
 *
 * /themself has rendered these since the record's first version; until now the
 * only way to write one was the raw-JSON escape hatch, so the field was
 * effectively invisible from the admin form.
 *
 * Deliberately NOT the resume's `LinksField`: that one is a work-sample picker
 * with an at:// / external-URL discriminator and a `visibility` flag, and none
 * of those concepts exist here.
 */
export default function LabelledLinksField({ value, onChange }) {
  const list = Array.isArray(value) ? value : [];
  const update = (i, patch) => onChange(replaceAt(list, i, { ...list[i], ...patch }));

  return (
    <div className="rf-list">
      {list.map((link, i) => (
        // Index keys: these rows are fully controlled and hold no local state.
        <div className="rf-card" key={i}>
          <div className="rf-card-head">
            <input
              className="admin-input"
              type="text"
              value={link?.label || ''}
              placeholder="Label, e.g. are.na"
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <RowControls
              index={i}
              length={list.length}
              onMove={(from, to) => onChange(move(list, from, to))}
              onRemove={(idx) => onChange(removeAt(list, idx))}
              removeLabel="Remove link"
            />
          </div>
          <input
            className="admin-input"
            type="url"
            value={link?.url || ''}
            placeholder="https://…"
            onChange={(e) => update(i, { url: e.target.value })}
          />
        </div>
      ))}
      <button
        type="button"
        className="rf-add"
        onClick={() => onChange([...list, { label: '', url: '' }])}
      >
        <Plus size={15} aria-hidden="true" /> Add link
      </button>
    </div>
  );
}
