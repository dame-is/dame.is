import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextBlockEditor from './TextBlockEditor.jsx';
import HeadingBlockEditor from './HeadingBlockEditor.jsx';
import ImageBlockEditor, { uploadImageFile } from './ImageBlockEditor.jsx';
import WebsiteBlockEditor from './WebsiteBlockEditor.jsx';
import CodeBlockEditor from './CodeBlockEditor.jsx';
import ListBlockEditor from './ListBlockEditor.jsx';
import BskyPostBlockEditor from './BskyPostBlockEditor.jsx';
import { LeafletBlock } from '../LeafletDocument.jsx';
import './blocks.css';

const WRAPPER_TYPE = 'pub.leaflet.pages.linearDocument#block';
const PAGE_TYPE = 'pub.leaflet.pages.linearDocument';
const CONTENT_TYPE = 'pub.leaflet.content';

/**
 * Editor for a `pub.leaflet.content` body. Produces records compatible
 * with site.standard.document and pub.leaflet.document.
 *
 * The body reads as a live preview of the rendered document; clicking a
 * block swaps that one block into its WYSIWYG editor. Only one block edits
 * at a time — clicking another block (or "Done", or away from the editor)
 * collapses the active block back to its preview.
 */
export default function BlocksEditor({ agent, did, value, onChange, onSetCover }) {
  const content = useMemo(() => ensureShape(value), [value]);
  const blocks = content.pages[0].blocks;

  const [activeIndex, setActiveIndex] = useState(null);
  // Which gap's "insert here" palette is open (an index into blocks, meaning
  // "insert before block N"), or null. Only one open at a time.
  const [openInsertSlot, setOpenInsertSlot] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null); // insertion slot (0..length)
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const rootRef = useRef(null);
  const activeItemRef = useRef(null);
  // Document-level undo/redo: stacks of whole-content snapshots. Consecutive
  // text edits to the same block coalesce into one entry so undo steps by edit
  // session (and by structural op), not by keystroke.
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const coalesceRef = useRef(null);

  const commit = useCallback(
    (nextBlocks, meta = {}) => {
      const coalesce = meta.kind === 'text' && coalesceRef.current === meta.blockIndex;
      if (!coalesce) {
        historyRef.current.push(content);
        if (historyRef.current.length > 200) historyRef.current.shift();
        setCanUndo(true);
      }
      coalesceRef.current = meta.kind === 'text' ? meta.blockIndex : null;
      // A fresh edit invalidates the redo stack.
      futureRef.current = [];
      setCanRedo(false);
      onChange({
        ...content,
        pages: [{ ...content.pages[0], blocks: nextBlocks }],
      });
    },
    [content, onChange],
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev == null) return;
    futureRef.current.push(content);
    setCanRedo(true);
    coalesceRef.current = null;
    setCanUndo(historyRef.current.length > 0);
    setActiveIndex(null);
    onChange(prev);
  }, [content, onChange]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (next == null) return;
    historyRef.current.push(content);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
    coalesceRef.current = null;
    setActiveIndex(null);
    onChange(next);
  }, [content, onChange]);

  const updateBlock = useCallback(
    (index, nextBlock) => {
      // A same-type edit is text (coalesces); a $type change is structural.
      const kind = blocks[index]?.block?.$type === nextBlock?.$type ? 'text' : 'structural';
      const next = blocks.slice();
      next[index] = { $type: WRAPPER_TYPE, block: nextBlock };
      commit(next, { kind, blockIndex: index });
    },
    [blocks, commit],
  );

  const insertBlock = useCallback(
    (block, atIndex = null) => {
      const next = blocks.slice();
      const wrapped = { $type: WRAPPER_TYPE, block };
      const index = atIndex == null ? next.length : atIndex;
      if (atIndex == null) next.push(wrapped);
      else next.splice(atIndex, 0, wrapped);
      commit(next, { kind: 'structural' });
      setActiveIndex(index); // jump straight into editing the new block
    },
    [blocks, commit],
  );

  const insertMany = useCallback(
    (newBlocks, atIndex = null) => {
      const wrapped = newBlocks.map((b) => ({ $type: WRAPPER_TYPE, block: b }));
      const next = blocks.slice();
      const index = atIndex == null ? next.length : atIndex;
      next.splice(index, 0, ...wrapped);
      commit(next, { kind: 'structural' });
    },
    [blocks, commit],
  );

  // Replace the text block at `index` with a paste that was detected as
  // markdown / multiple paragraphs: whatever preceded the caret (head) stays
  // as a text block, the converted blocks land next, and whatever followed the
  // caret (tail) trails as a text block. Empty head/tail are dropped, so
  // pasting into an empty block simply swaps in the converted blocks. Committed
  // as one structural op, so a single ⌘Z undoes the whole paste.
  const pasteBlocksAt = useCallback(
    (index, { head, tail, blocks: pasted }) => {
      const seq = [];
      if (head && head.text.trim()) {
        seq.push({ $type: 'pub.leaflet.blocks.text', plaintext: head.text, facets: head.facets });
      }
      seq.push(...(pasted || []));
      if (tail && tail.text.trim()) {
        seq.push({ $type: 'pub.leaflet.blocks.text', plaintext: tail.text, facets: tail.facets });
      }
      if (seq.length === 0) return;
      const wrapped = seq.map((b) => ({ $type: WRAPPER_TYPE, block: b }));
      const next = blocks.slice();
      next.splice(index, 1, ...wrapped);
      commit(next, { kind: 'structural' });
      setActiveIndex(null);
    },
    [blocks, commit],
  );

  const removeBlock = useCallback(
    (index) => {
      const next = blocks.slice();
      next.splice(index, 1);
      if (next.length === 0) {
        next.push({
          $type: WRAPPER_TYPE,
          block: { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] },
        });
      }
      commit(next, { kind: 'structural' });
      setActiveIndex(null);
    },
    [blocks, commit],
  );

  const moveBlock = useCallback(
    (index, dir) => {
      const target = index + dir;
      if (target < 0 || target >= blocks.length) return;
      const next = blocks.slice();
      [next[index], next[target]] = [next[target], next[index]];
      commit(next, { kind: 'structural' });
      setActiveIndex(target); // follow the block that moved
    },
    [blocks, commit],
  );

  // Move a block from `from` to an insertion slot (0..length).
  const moveTo = useCallback(
    (from, insertion) => {
      if (from == null) return;
      const next = blocks.slice();
      const [moved] = next.splice(from, 1);
      let target = from < insertion ? insertion - 1 : insertion;
      target = Math.max(0, Math.min(target, next.length));
      next.splice(target, 0, moved);
      commit(next, { kind: 'structural' });
      setActiveIndex(null);
    },
    [blocks, commit],
  );

  const handleDragStart = useCallback((e, i) => {
    setActiveIndex(null); // collapse any open editor while dragging
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(i));
    } catch {
      /* some browsers disallow setData here; index lives in state anyway */
    }
    const li = e.currentTarget.closest('li');
    if (li) {
      try {
        e.dataTransfer.setDragImage(li, 16, 16);
      } catch {
        /* setDragImage unsupported — fall back to the default handle image */
      }
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const slotFor = (e, i) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2 ? i + 1 : i;
  };

  const handleDragOver = useCallback(
    (e, i) => {
      if (dragIndex == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropIndex(slotFor(e, i));
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (e, i) => {
      if (dragIndex == null) return;
      e.preventDefault();
      moveTo(dragIndex, slotFor(e, i));
      setDragIndex(null);
      setDropIndex(null);
    },
    [dragIndex, moveTo],
  );

  // Collapse the active editor / insert palette when the user clicks outside.
  useEffect(() => {
    if (activeIndex == null && openInsertSlot == null) return undefined;
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setActiveIndex(null);
        setOpenInsertSlot(null);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [activeIndex, openInsertSlot]);

  // Editing a block and an open insert palette are mutually exclusive focuses:
  // opening one closes the other.
  useEffect(() => {
    if (activeIndex != null) setOpenInsertSlot(null);
  }, [activeIndex]);

  const openInsert = useCallback((index) => {
    setActiveIndex(null);
    setOpenInsertSlot(index);
  }, []);

  // Drop focus into the block that just became active — and again if its type
  // changes underfoot (e.g. converting text → heading swaps the editor).
  const activeType = activeIndex != null ? blocks[activeIndex]?.block?.$type : null;
  useEffect(() => {
    if (activeIndex == null) return;
    focusFirstField(activeItemRef.current);
  }, [activeIndex, activeType]);

  const handleRootKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape' && openInsertSlot != null) {
        e.preventDefault();
        setOpenInsertSlot(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if (isZ && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((isZ && e.shiftKey) || isY) {
        e.preventDefault();
        redo();
      }
    },
    [undo, redo, openInsertSlot],
  );

  return (
    <div className="blocks-editor" ref={rootRef} onKeyDown={handleRootKeyDown}>
      <div className="blocks-editor-toolbar">
        <button
          type="button"
          className="admin-link-subtle"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘/Ctrl+Z) — reorders, deletes, type changes"
        >
          ↶ Undo
        </button>
        <button
          type="button"
          className="admin-link-subtle"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⌘/Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
      </div>
      <ol className="blocks-editor-list">
        {blocks.map((wrap, i) => {
          const block = wrap?.block || {};
          const isActive = i === activeIndex;
          // Drop indicator, suppressed for no-op drops back into the same slot.
          const showBefore =
            dragIndex != null &&
            dropIndex === i &&
            dropIndex !== dragIndex &&
            dropIndex !== dragIndex + 1;
          const showAfter =
            dragIndex != null &&
            i === blocks.length - 1 &&
            dropIndex === blocks.length &&
            dropIndex !== dragIndex + 1;
          const cls = [
            'blocks-editor-item',
            isActive ? 'is-active' : 'is-preview',
            dragIndex === i ? 'is-dragging' : '',
            openInsertSlot === i ? 'has-insert-open' : '',
            showBefore ? 'drop-before' : '',
            showAfter ? 'drop-after' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li
              key={i}
              ref={isActive ? activeItemRef : null}
              className={cls}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
            >
              {dragIndex == null && (
                <InsertSlot
                  index={i}
                  open={openInsertSlot === i}
                  onOpen={openInsert}
                  onClose={() => setOpenInsertSlot(null)}
                  agent={agent}
                  did={did}
                  onInsert={(block) => {
                    insertBlock(block, i);
                    setOpenInsertSlot(null);
                  }}
                  onInsertMany={(bs) => {
                    insertMany(bs, i);
                    setOpenInsertSlot(null);
                  }}
                />
              )}
              <div
                className="blocks-editor-handle"
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragEnd={handleDragEnd}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                role="button"
                tabIndex={-1}
                aria-label="Drag to reorder"
                title="Drag to reorder"
              >
                ⠿
              </div>

              {isActive ? (
                <div className="blocks-editor-main">
                  <div className="blocks-editor-item-controls">
                    <span className="blocks-editor-item-type small-caps">{labelFor(block.$type)}</span>
                    <div className="blocks-editor-item-buttons">
                      <button
                        type="button"
                        className="admin-link-subtle"
                        onClick={() => moveBlock(i, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="admin-link-subtle"
                        onClick={() => moveBlock(i, 1)}
                        disabled={i === blocks.length - 1}
                        aria-label="Move down"
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="admin-link-subtle blocks-editor-done"
                        onClick={() => setActiveIndex(null)}
                        title="Done editing this block"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                  <BlockBody
                    block={block}
                    agent={agent}
                    did={did}
                    onChange={(next) => updateBlock(i, next)}
                    onSetCover={onSetCover}
                    onPasteBlocks={(payload) => pasteBlocksAt(i, payload)}
                  />
                  <BlockLayoutControls block={block} onChange={(next) => updateBlock(i, next)} />
                </div>
              ) : (
                <div
                  className="blocks-editor-main blocks-editor-click"
                  onClick={() => setActiveIndex(i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveIndex(i);
                    }
                  }}
                  aria-label={`Edit ${labelFor(block.$type)} block`}
                >
                  <BlockPreview block={block} />
                </div>
              )}

              <button
                type="button"
                className="blocks-editor-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBlock(i);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Delete block"
                title="Delete block"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      <BlockAdder agent={agent} onInsert={insertBlock} onInsertMany={insertMany} />
    </div>
  );
}

function BlockBody({ block, agent, did, onChange, onSetCover, onPasteBlocks }) {
  switch (block.$type) {
    case 'pub.leaflet.blocks.text':
      return <TextBlockEditor block={block} onChange={onChange} onPasteBlocks={onPasteBlocks} />;
    case 'pub.leaflet.blocks.header':
      return <HeadingBlockEditor block={block} onChange={onChange} />;
    case 'pub.leaflet.blocks.image':
      return <ImageBlockEditor block={block} agent={agent} did={did} onChange={onChange} />;
    case 'pub.leaflet.blocks.website':
      return (
        <WebsiteBlockEditor
          block={block}
          agent={agent}
          did={did}
          onChange={onChange}
          onSetCover={onSetCover}
        />
      );
    case 'pub.leaflet.blocks.code':
      return <CodeBlockEditor block={block} onChange={onChange} />;
    case 'pub.leaflet.blocks.unorderedList':
    case 'pub.leaflet.blocks.orderedList':
      return <ListBlockEditor block={block} onChange={onChange} />;
    case 'pub.leaflet.blocks.bskyPost':
      return <BskyPostBlockEditor block={block} onChange={onChange} />;
    default:
      return (
        <pre className="blocks-editor-unknown">
          {JSON.stringify(block, null, 2)}
        </pre>
      );
  }
}

/**
 * Per-block layout controls under the active block's editor: indent (text
 * paragraphs only) plus extra space above / below any block, so an author can
 * shape spacing without inserting empty spacer blocks. Values are stored on the
 * block (`indent`, `spaceTop`, `spaceBottom`) and read by the renderer (see
 * LeafletDocument's blockLayoutStyle). Absent = the default: stacked paragraphs
 * auto-indent, and there's no extra space.
 */
function BlockLayoutControls({ block, onChange }) {
  const isText = block.$type === 'pub.leaflet.blocks.text';
  const setField = (key, value) => {
    const next = { ...block };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const indentValue = block.indent == null ? 'auto' : block.indent ? 'on' : 'off';
  return (
    <div className="block-layout-controls">
      {isText && (
        <label className="block-layout-field">
          <span className="small-caps">Indent</span>
          <select
            className="block-layout-select"
            value={indentValue}
            onChange={(e) => {
              const v = e.target.value;
              setField('indent', v === 'auto' ? undefined : v === 'on');
            }}
          >
            <option value="auto">Auto</option>
            <option value="on">Indented</option>
            <option value="off">Flush</option>
          </select>
        </label>
      )}
      <label className="block-layout-field">
        <span className="small-caps">Space above</span>
        <SpaceSelect value={block.spaceTop} onChange={(v) => setField('spaceTop', v)} />
      </label>
      <label className="block-layout-field">
        <span className="small-caps">Space below</span>
        <SpaceSelect value={block.spaceBottom} onChange={(v) => setField('spaceBottom', v)} />
      </label>
    </div>
  );
}

function SpaceSelect({ value, onChange }) {
  return (
    <select
      className="block-layout-select"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">None</option>
      <option value="sm">Small</option>
      <option value="md">Medium</option>
      <option value="lg">Large</option>
    </select>
  );
}

/**
 * Read-only render of a single block for the collapsed (preview) state.
 * Reuses the published renderer so the body genuinely reads as the live
 * document; empty blocks show a click-to-edit hint so they stay reachable.
 */
function BlockPreview({ block }) {
  if (isBlockEmpty(block)) {
    return (
      <div className="blocks-editor-preview blocks-editor-preview-empty">
        {`Empty ${labelFor(block.$type)} — click to edit`}
      </div>
    );
  }
  // An uploaded image only has a render URL once the record is re-read, so a
  // fresh blob can't be drawn yet — show a neutral note instead of a blank.
  if (block.$type === 'pub.leaflet.blocks.image' && !(block.image?._url || block.url)) {
    return (
      <div className="blocks-editor-preview blocks-editor-preview-empty">
        Image — click to edit
      </div>
    );
  }
  return (
    <div className="blocks-editor-preview">
      <div className="blocks-editor-preview-body">
        <LeafletBlock block={block} />
      </div>
    </div>
  );
}

function isBlockEmpty(block) {
  switch (block?.$type) {
    case 'pub.leaflet.blocks.text':
    case 'pub.leaflet.blocks.header':
      return !(block.plaintext || '').trim();
    case 'pub.leaflet.blocks.image':
      return !(block.image || block.url);
    case 'pub.leaflet.blocks.website':
      return !block.src;
    case 'pub.leaflet.blocks.code':
      return !(block.plaintext || block.code || '').trim();
    case 'pub.leaflet.blocks.bskyPost':
      return !block.postRef?.uri;
    case 'pub.leaflet.blocks.unorderedList':
    case 'pub.leaflet.blocks.orderedList':
      return !(block.children || []).some((it) => (it?.content?.plaintext || '').trim());
    default:
      return false;
  }
}

/** Focus (and place the caret at the end of) the first editable field. */
function focusFirstField(container) {
  if (!container) return;
  const el = container.querySelector(
    '[contenteditable="true"], input:not([type="file"]), textarea, select',
  );
  if (!el) return;
  el.focus();
  if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/**
 * The shared block-type palette: one button per block kind, plus a multi-image
 * "Gallery…" upload. `onInsert(block)` / `onInsertMany(blocks)` decide where the
 * new block(s) land — the bottom adder appends; an insert slot drops them at a
 * specific gap.
 */
function BlockPalette({ agent, onInsert, onInsertMany }) {
  const galleryInputRef = useRef(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  async function handleGallery(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setUploadStatus(`Uploading ${files.length} image${files.length === 1 ? '' : 's'}…`);
    const blocks = [];
    for (let i = 0; i < files.length; i++) {
      try {
        setUploadStatus(`Uploading ${i + 1} of ${files.length}…`);
        const { blob, aspectRatio } = await uploadImageFile(agent, files[i]);
        blocks.push({
          $type: 'pub.leaflet.blocks.image',
          image: blob,
          alt: '',
          ...(aspectRatio ? { aspectRatio } : {}),
        });
      } catch (err) {
        setUploadStatus(`Upload failed: ${err?.message || err}`);
        return;
      }
    }
    onInsertMany(blocks);
    setUploadStatus(null);
  }

  return (
    <>
      <div className="blocks-editor-add-buttons">
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] })}>
          Text
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.header', plaintext: '', level: 2 })}>
          Heading
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.image', alt: '' })}>
          Image
        </AddButton>
        <AddButton
          onClick={() => galleryInputRef.current?.click()}
          title="Upload several images at once — each becomes its own image block."
        >
          Gallery…
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.website', src: '' })}>
          Link card
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.code', plaintext: '' })}>
          Code
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.unorderedList', children: [emptyListItem()] })}>
          List
        </AddButton>
        <AddButton onClick={() => onInsert({ $type: 'pub.leaflet.blocks.bskyPost', postRef: { uri: '' } })}>
          Bsky post
        </AddButton>
        <AddButton
          onClick={() => onInsert({ $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] })}
          title="Inserts an empty text block — renders as a paragraph spacer."
        >
          Divider
        </AddButton>
      </div>
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleGallery}
      />
      {uploadStatus && <p className="admin-field-hint">{uploadStatus}</p>}
    </>
  );
}

/** Bottom-of-editor adder — appends a new block. */
function BlockAdder({ agent, onInsert, onInsertMany }) {
  return (
    <div className="blocks-editor-add">
      <div className="blocks-editor-add-label small-caps gutter">Add block</div>
      <BlockPalette agent={agent} onInsert={onInsert} onInsertMany={onInsertMany} />
    </div>
  );
}

/**
 * Between-blocks inserter: a "+" that appears in the gap at the top of a block
 * (revealed on hover) and, when clicked, drops the block-type palette right
 * there so a new block lands at that slot instead of at the bottom.
 */
function InsertSlot({ index, open, onOpen, onClose, agent, onInsert, onInsertMany }) {
  return (
    <div className={`blocks-editor-insert${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="blocks-editor-insert-btn"
        onClick={(e) => {
          e.stopPropagation();
          if (open) onClose();
          else onOpen(index);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Insert a block here"
        aria-expanded={open}
        title="Insert a block here"
      >
        <span aria-hidden="true">+</span>
      </button>
      {open && (
        <div
          className="blocks-editor-insert-menu"
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <BlockPalette agent={agent} onInsert={onInsert} onInsertMany={onInsertMany} />
        </div>
      )}
    </div>
  );
}

function AddButton({ children, onClick, title }) {
  return (
    <button type="button" className="blocks-editor-add-btn" onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function labelFor(type) {
  switch (type) {
    case 'pub.leaflet.blocks.text': return 'text';
    case 'pub.leaflet.blocks.header': return 'heading';
    case 'pub.leaflet.blocks.image': return 'image';
    case 'pub.leaflet.blocks.website': return 'link card';
    case 'pub.leaflet.blocks.code': return 'code';
    case 'pub.leaflet.blocks.unorderedList': return 'list';
    case 'pub.leaflet.blocks.orderedList': return 'list (ordered)';
    case 'pub.leaflet.blocks.bskyPost': return 'bsky post';
    default: return type || 'block';
  }
}

function emptyListItem() {
  return {
    $type: 'pub.leaflet.blocks.unorderedList#listItem',
    content: { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] },
    children: [],
  };
}

function ensureShape(value) {
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray(value.pages) &&
    value.pages[0] &&
    Array.isArray(value.pages[0].blocks)
  ) {
    return value;
  }
  return {
    $type: CONTENT_TYPE,
    pages: [
      {
        $type: PAGE_TYPE,
        blocks: [
          {
            $type: WRAPPER_TYPE,
            block: { $type: 'pub.leaflet.blocks.text', plaintext: '', facets: [] },
          },
        ],
      },
    ],
  };
}
