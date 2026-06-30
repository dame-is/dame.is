import { RichTextField } from './TextBlockEditor.jsx';

export default function HeadingBlockEditor({ block, onChange }) {
  const level = clampLevel(block.level);
  return (
    <RichTextField
      text={block.plaintext || ''}
      facets={block.facets || []}
      rows={2}
      blockType="heading"
      headingLevel={level}
      onConvert={({ type, level: nextLevel }) => {
        if (type === 'text') {
          // Drop to a body paragraph, keeping the text + marks.
          onChange({
            $type: 'pub.leaflet.blocks.text',
            plaintext: block.plaintext || '',
            facets: block.facets || [],
          });
        } else {
          onChange({ ...block, level: clampLevel(nextLevel) });
        }
      }}
      onChange={({ text, facets }) => onChange({ ...block, plaintext: text, facets })}
    />
  );
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}
