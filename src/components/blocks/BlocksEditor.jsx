import { useCallback, useMemo, useRef, useState } from 'react';
import TextBlockEditor from './TextBlockEditor.jsx';
import HeadingBlockEditor from './HeadingBlockEditor.jsx';
import ImageBlockEditor, { uploadImageFile } from './ImageBlockEditor.jsx';
import WebsiteBlockEditor from './WebsiteBlockEditor.jsx';
import CodeBlockEditor from './CodeBlockEditor.jsx';
import ListBlockEditor from './ListBlockEditor.jsx';
import BskyPostBlockEditor from './BskyPostBlockEditor.jsx';
import './blocks.css';

const WRAPPER_TYPE = 'pub.leaflet.pages.linearDocument#block';
const PAGE_TYPE = 'pub.leaflet.pages.linearDocument';
const CONTENT_TYPE = 'pub.leaflet.content';

/**
 * Editor for a `pub.leaflet.content` body. Produces records compatible
 * with site.standard.document and pub.leaflet.document. Walks the first
 * (and only) page's blocks array; everything happens inline.
 */
export default function BlocksEditor({ agent, did, value, onChange }) {
  const content = useMemo(() => ensureShape(value), [value]);
  const blocks = content.pages[0].blocks;

  const updateBlocks = useCallback(
    (nextBlocks) => {
      onChange({
        ...content,
        pages: [{ ...content.pages[0], blocks: nextBlocks }],
      });
    },
    [content, onChange],
  );

  const updateBlock = useCallback(
    (index, nextBlock) => {
      const next = blocks.slice();
      next[index] = { $type: WRAPPER_TYPE, block: nextBlock };
      updateBlocks(next);
    },
    [blocks, updateBlocks],
  );

  const insertBlock = useCallback(
    (block, atIndex = null) => {
      const next = blocks.slice();
      const wrapped = { $type: WRAPPER_TYPE, block };
      if (atIndex == null) next.push(wrapped);
      else next.splice(atIndex, 0, wrapped);
      updateBlocks(next);
    },
    [blocks, updateBlocks],
  );

  const insertMany = useCallback(
    (newBlocks) => {
      const next = blocks.concat(newBlocks.map((b) => ({ $type: WRAPPER_TYPE, block: b })));
      updateBlocks(next);
    },
    [blocks, updateBlocks],
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
      updateBlocks(next);
    },
    [blocks, updateBlocks],
  );

  const moveBlock = useCallback(
    (index, dir) => {
      const target = index + dir;
      if (target < 0 || target >= blocks.length) return;
      const next = blocks.slice();
      [next[index], next[target]] = [next[target], next[index]];
      updateBlocks(next);
    },
    [blocks, updateBlocks],
  );

  return (
    <div className="blocks-editor">
      <ol className="blocks-editor-list">
        {blocks.map((wrap, i) => {
          const block = wrap?.block || {};
          return (
            <li key={i} className="blocks-editor-item">
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
                    className="admin-link-subtle"
                    onClick={() => removeBlock(i)}
                    aria-label="Delete block"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <BlockBody
                block={block}
                agent={agent}
                did={did}
                onChange={(next) => updateBlock(i, next)}
              />
            </li>
          );
        })}
      </ol>
      <BlockAdder agent={agent} did={did} onInsert={insertBlock} onInsertMany={insertMany} />
    </div>
  );
}

function BlockBody({ block, agent, did, onChange }) {
  switch (block.$type) {
    case 'pub.leaflet.blocks.text':
      return <TextBlockEditor block={block} onChange={onChange} />;
    case 'pub.leaflet.blocks.header':
      return <HeadingBlockEditor block={block} onChange={onChange} />;
    case 'pub.leaflet.blocks.image':
      return <ImageBlockEditor block={block} agent={agent} did={did} onChange={onChange} />;
    case 'pub.leaflet.blocks.website':
      return <WebsiteBlockEditor block={block} agent={agent} did={did} onChange={onChange} />;
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

function BlockAdder({ agent, did, onInsert, onInsertMany }) {
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
    <div className="blocks-editor-add">
      <div className="blocks-editor-add-label small-caps gutter">Add block</div>
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
