import { useCallback, useRef, useState } from 'react';
import {
  charsToBytes,
  toggleFeature,
  applyLink,
  remapFacets,
  FORMAT_TYPES,
  LINK_TYPE,
} from './facetUtils.js';

export default function TextBlockEditor({ block, onChange }) {
  return (
    <RichTextField
      text={block.plaintext || ''}
      facets={block.facets || []}
      onChange={({ text, facets }) =>
        onChange({ ...block, plaintext: text, facets })
      }
      rows={4}
    />
  );
}

/**
 * Plain textarea + a toolbar that mutates the accompanying facets[]
 * based on the current selection. Reused by HeadingBlockEditor and the
 * list-item editor.
 *
 * Note: the textarea itself doesn't visually reflect bold/italic/etc. —
 * that lives in the rendered output. The toolbar applies semantic marks
 * to the selection; users see the formatted result on the published
 * page. This trade-off keeps the editor's selection model simple and
 * dodges contentEditable's bag of bugs.
 */
export function RichTextField({ text, facets, onChange, rows = 4 }) {
  const taRef = useRef(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const captureSelection = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    setSelection({ start: el.selectionStart, end: el.selectionEnd });
  }, []);

  const handleTextChange = useCallback(
    (e) => {
      const nextText = e.target.value;
      const nextFacets = remapFacets(text, nextText, facets);
      onChange({ text: nextText, facets: nextFacets });
    },
    [text, facets, onChange],
  );

  const toggle = useCallback(
    (typeKey) => {
      const el = taRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (end <= start) return;
      const byteStart = charsToBytes(text, start);
      const byteEnd = charsToBytes(text, end);
      const nextFacets = toggleFeature(facets, byteStart, byteEnd, {
        $type: FORMAT_TYPES[typeKey],
      });
      onChange({ text, facets: nextFacets });
    },
    [text, facets, onChange],
  );

  const addLink = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end <= start) {
      window.alert('Select some text first, then click the link button.');
      return;
    }
    const url = window.prompt('Link URL', 'https://');
    if (!url || url === 'https://') return;
    const byteStart = charsToBytes(text, start);
    const byteEnd = charsToBytes(text, end);
    onChange({ text, facets: applyLink(facets, byteStart, byteEnd, url) });
  }, [text, facets, onChange]);

  const removeLink = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end <= start) return;
    const byteStart = charsToBytes(text, start);
    const byteEnd = charsToBytes(text, end);
    onChange({ text, facets: toggleFeature(facets, byteStart, byteEnd, { $type: LINK_TYPE }) });
  }, [text, facets, onChange]);

  const hasSelection = selection.end > selection.start;

  return (
    <div className="rich-text-field">
      <div className="rich-text-toolbar" role="toolbar" aria-label="Formatting">
        <ToolbarButton onClick={() => toggle('bold')} disabled={!hasSelection} title="Bold">
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton onClick={() => toggle('italic')} disabled={!hasSelection} title="Italic">
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton onClick={() => toggle('underline')} disabled={!hasSelection} title="Underline">
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton onClick={() => toggle('strikethrough')} disabled={!hasSelection} title="Strikethrough">
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton onClick={() => toggle('code')} disabled={!hasSelection} title="Inline code">
          <code>{'<>'}</code>
        </ToolbarButton>
        <ToolbarButton onClick={() => toggle('highlight')} disabled={!hasSelection} title="Highlight">
          <mark>H</mark>
        </ToolbarButton>
        <ToolbarButton onClick={addLink} disabled={!hasSelection} title="Add or replace link">
          🔗
        </ToolbarButton>
        <ToolbarButton onClick={removeLink} disabled={!hasSelection} title="Remove link">
          ⛓️‍💥
        </ToolbarButton>
      </div>
      <textarea
        ref={taRef}
        className="admin-input admin-textarea rich-text-textarea"
        value={text}
        rows={rows}
        onChange={handleTextChange}
        onSelect={captureSelection}
        onKeyUp={captureSelection}
        onMouseUp={captureSelection}
      />
      {facets.length > 0 && (
        <p className="admin-field-hint rich-text-facet-summary">
          {summarize(facets)}
        </p>
      )}
    </div>
  );
}

function ToolbarButton({ children, onClick, disabled, title }) {
  return (
    <button
      type="button"
      className="rich-text-toolbar-btn"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function summarize(facets) {
  const counts = {};
  for (const f of facets) {
    for (const feat of f.features || []) {
      const key = feat.$type.replace('pub.leaflet.richtext.facet#', '');
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const parts = Object.entries(counts).map(([k, v]) => `${k}×${v}`);
  return `${facets.length} facet${facets.length === 1 ? '' : 's'} (${parts.join(', ')})`;
}
