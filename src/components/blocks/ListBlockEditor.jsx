import { RichTextField } from './TextBlockEditor.jsx';
import {
  emptyListItem,
  isOrdered,
  listItemType,
  listToTextBlock,
  listType,
  retypeList,
} from './listBlocks.js';

/**
 * Editor for pub.leaflet.blocks.{unordered,ordered}List. Each list item has its
 * own rich text and an optional nested list, handled recursively.
 *
 * The top-level editor carries the block-type controls, so a list can be turned
 * back into a paragraph or switched between bulleted and numbered from the same
 * row of buttons a paragraph uses to become a list. Nested editors don't — a
 * sub-list has no business converting the block it lives inside.
 */
export default function ListBlockEditor({ block, onChange, nested = false }) {
  const ordered = isOrdered(block);
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
    setItems(arr.length === 0 ? [emptyListItem(ordered)] : arr);
  }

  function addItem() {
    setItems(items.concat([emptyListItem(ordered)]));
  }

  // Switching kind has to retype every descendant, not just the block.
  function convert({ type }) {
    if (type === 'text') onChange(listToTextBlock(block));
    else if (type === 'bulletList') onChange(retypeList(block, false));
    else if (type === 'numberList') onChange(retypeList(block, true));
  }

  return (
    <div className="list-block-editor">
      <ul className="list-block-editor-items">
        {items.map((item, i) => (
          <ListItemEditor
            key={i}
            item={item}
            ordered={ordered}
            // Only the first item shows the block-type row, so a five-item list
            // doesn't repeat the same five buttons five times.
            onConvert={!nested && i === 0 ? convert : null}
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

function ListItemEditor({ item, ordered, onChange, onRemove, onConvert }) {
  const content = item?.content || { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] };
  const children = Array.isArray(item?.children) ? item.children : [];

  function setContent({ text, facets }) {
    onChange({
      ...item,
      $type: listItemType(ordered),
      content: { ...content, plaintext: text, facets },
    });
  }

  function setNested(nextNested) {
    onChange({ ...item, $type: listItemType(ordered), children: nextNested });
  }

  return (
    <li className="list-block-editor-item">
      <div className="list-block-editor-item-controls">
        <button type="button" className="admin-link-subtle" onClick={onRemove} title="Remove item">
          ✕
        </button>
      </div>
      <RichTextField
        text={content.plaintext || ''}
        facets={content.facets || []}
        rows={2}
        blockType={ordered ? 'numberList' : 'bulletList'}
        onConvert={onConvert}
        onChange={setContent}
      />
      {children.length > 0 && (
        <div className="list-block-editor-nested">
          <ListBlockEditor
            nested
            // A list type, not the item's own #listItem type — passing the
            // latter would read as unordered and flip every sub-list to bullets.
            block={{ $type: listType(ordered), children }}
            onChange={(next) => setNested(next.children)}
          />
        </div>
      )}
      {children.length === 0 && (
        <button type="button" className="admin-link-subtle" onClick={() => setNested([emptyListItem(ordered)])}>
          + Nest
        </button>
      )}
    </li>
  );
}
