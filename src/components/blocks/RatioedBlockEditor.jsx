const VARIANTS = [
  ['lifelines', 'Lifelines', 'Every backlink plotted against time, with the threadgate as a hard rule and a log-scaled afterlife.'],
  ['reaction', 'Reaction times', 'How long it took you to close each piece by hand. Deleted likes show as an inferred window.'],
  ['ledger', 'Ledger', 'Engagement before and after the seal, per piece.'],
];

export default function RatioedBlockEditor({ block, onChange }) {
  const variant = block?.variant || 'lifelines';
  const current = VARIANTS.find(([v]) => v === variant);
  return (
    <div className="ratioed-block-editor">
      <label className="admin-field-label">
        Chart
        <select
          className="admin-input"
          value={variant}
          onChange={(e) => onChange({ ...block, variant: e.target.value })}
        >
          {VARIANTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {current && <p className="admin-field-hint">{current[2]}</p>}

      <label className="admin-field-label">
        Alt text
        <input
          className="admin-input"
          type="text"
          value={block?.alt || ''}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
          placeholder="What the chart shows, for screen readers."
        />
      </label>

      <label className="admin-field-checkbox">
        <input
          type="checkbox"
          checked={!!block?.showLive}
          onChange={(e) => onChange({ ...block, showLive: e.target.checked })}
        />
        Show what each piece has picked up since it was measured
      </label>
      <p className="admin-field-hint">
        Queries Constellation on render — one request per piece. The recorded figures stay
        authoritative; this only adds a delta on top.
      </p>

      <p className="admin-field-hint">
        Only this site renders <code>is.dame.blocks.ratioed</code>. Anywhere else this document is
        read, the chart is skipped — follow it with a text block carrying the same figures.
      </p>
    </div>
  );
}
