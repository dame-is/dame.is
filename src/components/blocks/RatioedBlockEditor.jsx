const VARIANTS = [
  ['summary', 'Summary', 'The project in six figures — pieces, time alive, people, the ratio, your mean reaction, and how many breakers deleted the like.'],
  ['lifelines', 'Lifelines', 'Every backlink plotted against time, with the threadgate as a hard rule and a log-scaled afterlife.'],
  ['reaction', 'Reaction times', 'How long it took you to close each piece by hand, in order. Deleted likes show as an inferred window.'],
  ['ledger', 'Ledger', 'Engagement before and after the seal, per piece.'],
  ['hidden', 'Replies nobody can see', 'The replies that landed after a seal — written to the network, hidden by the threadgate.'],
  ['participants', 'Participants', 'Everyone who touched a piece, sortable, with who broke what.'],
  ['when', 'When they happened', 'Every piece on a week grid by day and hour, each mark sized by how long it lived and how much it drew.'],
];

// Mirrors DEFAULT_CAPTIONS in RatioedBlock.jsx, trimmed to a placeholder. The
// live defaults quote real figures, which an editor placeholder can't; these
// say the same thing without the numbers.
const DEFAULTS = {
  summary: 'How many of the people involved showed up while a piece was still alive.',
  lifelines:
    'Every record pointing at a piece, plotted against the seconds it arrived. The rule is the threadgate.',
  reaction:
    'Mean and range of the reaction times still measurable, and what the hatched bars stand in for.',
  ledger: 'Engagement either side of the seal.',
  hidden: 'A threadgate hides replies at the appview; it does not stop the records being written.',
  participants: 'Counted by DID, not handle — and which breakers left no trace at all.',
  when: 'Every piece by the clock it was made on, sized by how long it lived and how much it drew.',
};

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

      <label className="admin-field-checkbox">
        <input
          type="checkbox"
          checked={block?.showCaption !== false}
          onChange={(e) => onChange({ ...block, showCaption: e.target.checked })}
        />
        Show the caption under the chart
      </label>

      {block?.showCaption !== false && (
        <label className="admin-field-label">
          Caption
          <textarea
            className="admin-input"
            rows={4}
            value={block?.caption || ''}
            onChange={(e) => onChange({ ...block, caption: e.target.value })}
            placeholder={DEFAULTS[variant] || 'Text shown under the chart.'}
          />
        </label>
      )}
      <p className="admin-field-hint">
        Leave blank to use the chart&rsquo;s own description — shown above as the placeholder. It
        quotes the live figures, so it stays right as the data changes; anything you type here is
        fixed prose.
      </p>

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
      <p className="admin-field-hint">
        Describes the chart to screen readers. Not shown on the page — that&rsquo;s the caption.
      </p>

      {(variant === 'lifelines' || variant === 'ledger') && (
        <>
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
        </>
      )}

      <p className="admin-field-hint">
        Only this site renders <code>is.dame.blocks.ratioed</code>. Anywhere else this document is
        read, the chart is skipped — follow it with a text block carrying the same figures.
      </p>
    </div>
  );
}
