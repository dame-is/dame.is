export default function CodeBlockEditor({ block, onChange }) {
  return (
    <div className="code-block-editor">
      <label className="admin-field-label">
        Language
        <input
          className="admin-input admin-input-narrow"
          type="text"
          value={block.language || ''}
          placeholder="js, ts, py, …"
          onChange={(e) => onChange({ ...block, language: e.target.value })}
        />
      </label>
      <textarea
        className="admin-input admin-textarea admin-mono"
        rows={8}
        value={block.plaintext || ''}
        onChange={(e) => onChange({ ...block, plaintext: e.target.value })}
      />
    </div>
  );
}
