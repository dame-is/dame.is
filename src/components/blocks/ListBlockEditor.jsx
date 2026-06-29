import { RichTextField } from './TextBlockEditor.jsx';

/**
 * Editor for pub.leaflet.blocks.{unordered,ordered}List. Each list item
 * has its own text content (with facets) and an optional nested list of
 * children. Nesting is handled recursively.
 */
export default function ListBlockEditor({ block, onChange }) {
  const ordered = block.$type === 'pub.leaflet.blocks.orderedList';
  const items = Array.isArray(block.children) ? block.children : [];

  function setItems(nextItems) {
    onChange({ ...block, children: nextItems });
  }

  function setItem(i, next) {
    const arr = items.slice();
    arr[i] = next;
    setItems(arr);
  }

  function removeItem(i) {
    const arr = items.slice();
    arr.splice(i, 1);
    setItems(arr.length === 0 ? [emptyItem()] : arr);
  }

  function addItem() {
    setItems(items.concat([emptyItem()]));
  }

  function toggleOrdered(e) {
    onChange({
      ...block,
      $type: e.target.checked
        ? 'pub.leaflet.blocks.orderedList'
        : 'pub.leaflet.blocks.unorderedList',
    });
  }

  return (
    <div className="list-block-editor">
      <label className="admin-checkbox list-block-editor-toggle">
        <input type="checkbox" checked={ordered} onChange={toggleOrdered} />
        <span>Ordered (numbered) list</span>
      </label>
      <ul className="list-block-editor-items">
        {items.map((item, i) => (
          <ListItemEditor
            key={i}
            item={item}
            ordered={ordered}
            onChange={(next) => setItem(i, next)}
            onRemove={() => removeItem(i)}
          />
        ))}
      </ul>
      <button type="button" className="admin-link-subtle" onClick={addItem}>
        + Add item
      </button>
    </div>
  );
}

function ListItemEditor({ item, ordered, onChange, onRemove }) {
  const content = item?.content || { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] };
  const children = Array.isArray(item?.children) ? item.children : [];

  function setContent({ text, facets }) {
    onChange({
      ...item,
      $type: nestedItemType(ordered),
      content: { ...content, plaintext: text, facets },
    });
  }

  function setNested(nextNested) {
    onChange({ ...item, $type: nestedItemType(ordered), children: nextNested });
  }

  return (
    <li className="list-block-editor-item">
      <div className="list-block-editor-item-controls">
        <button type="button" className="admin-link-subtle" onClick={onRemove}>✕</button>
      </div>
      <RichTextField
        text={content.plaintext || ''}
        facets={content.facets || []}
        rows={2}
        onChange={setContent}
      />
      {children.length > 0 && (
        <div className="list-block-editor-nested">
          <ListBlockEditor
            block={{
              $type: ordered ? 'pub.leaflet.blocks.orderedList' : 'pub.leaflet.blocks.unorderedList',
              children,
            }}
            onChange={(next) => setNested(next.children)}
          />
        </div>
      )}
      {children.length === 0 && (
        <button
          type="button"
          className="admin-link-subtle"
          onClick={() => setNested([emptyItem()])}
        >
          + Nest
        </button>
      )}
    </li>
  );
}

function emptyItem() {
  return {
    $type: 'pub.leaflet.blocks.unorderedList#listItem',
    content: { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] },
    children: [],
  };
}

function nestedItemType(ordered) {
  return ordered
    ? 'pub.leaflet.blocks.orderedList#listItem'
    : 'pub.leaflet.blocks.unorderedList#listItem';
}
