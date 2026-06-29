import { RichTextField } from './TextBlockEditor.jsx';

export default function HeadingBlockEditor({ block, onChange }) {
  const level = clampLevel(block.level);
  return (
    <div className="heading-block-editor">
      <div className="heading-block-editor-level">
        <label className="admin-field-hint">Level</label>
        <select
          className="admin-input admin-input-narrow"
          value={level}
          onChange={(e) => onChange({ ...block, level: Number(e.target.value) })}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>H{n}</option>
          ))}
        </select>
      </div>
      <RichTextField
        text={block.plaintext || ''}
        facets={block.facets || []}
        rows={2}
        onChange={({ text, facets }) =>
          onChange({ ...block, plaintext: text, facets })
        }
      />
    </div>
  );
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}
