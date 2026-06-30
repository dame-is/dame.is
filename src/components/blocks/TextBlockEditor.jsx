import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  charsToBytes,
  toggleFeature,
  applyLink,
  applyFeatureAlways,
  removeFeatureAlways,
  featureTypesForRange,
  facetRuns,
  runsToFacets,
  FORMAT_TYPES,
  LINK_TYPE,
  KEY_FOR_TYPE,
} from './facetUtils.js';

export default function TextBlockEditor({ block, onChange }) {
  return (
    <RichTextField
      text={block.plaintext || ''}
      facets={block.facets || []}
      onChange={({ text, facets }) => onChange({ ...block, plaintext: text, facets })}
      rows={4}
    />
  );
}

/* ------------------------------------------------------------------ */
/* WYSIWYG rich-text editor                                            */
/* ------------------------------------------------------------------ */

const FORMAT_BUTTONS = [
  { key: 'bold', node: <strong>B</strong>, title: 'Bold' },
  { key: 'italic', node: <em>I</em>, title: 'Italic' },
  { key: 'underline', node: <u>U</u>, title: 'Underline' },
  { key: 'strikethrough', node: <s>S</s>, title: 'Strikethrough' },
  { key: 'code', node: <code>{'<>'}</code>, title: 'Inline code' },
  { key: 'highlight', node: <mark>H</mark>, title: 'Highlight' },
];

/**
 * A contentEditable surface that renders leaflet `plaintext` + `facets`
 * inline (WYSIWYG) and serializes edits back to the same shape. Reused by
 * the text block, heading block, and list items.
 *
 * Model: the DOM is the source of truth while typing (we parse it back on
 * `input`); formatting commands and "pending marks" rewrite the DOM and
 * restore the caret by character offset. The marks toolbar can be toggled
 * with no selection to arm formatting for whatever you type next, and
 * reflects the formatting under the caret / selection.
 */
export function RichTextField({ text, facets, onChange, rows = 4 }) {
  const editorRef = useRef(null);
  const lastEmittedRef = useRef('');
  const pendingCaretRef = useRef(null);
  const prevTextRef = useRef(text);
  const pendingMarksRef = useRef({}); // { key: boolean } overrides for next typed text
  const composingRef = useRef(false);

  const textRef = useRef(text);
  textRef.current = text;
  const facetsRef = useRef(facets);
  facetsRef.current = facets;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [active, setActive] = useState({});
  const [hasSelection, setHasSelection] = useState(false);

  const refreshActive = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const r = getSelectionRange(editor);
    if (!r) {
      setHasSelection(false);
      setActive(effectiveActive([], pendingMarksRef.current));
      return;
    }
    setHasSelection(!r.collapsed);
    const t = textRef.current;
    if (r.collapsed) {
      let leftKeys = [];
      if (r.start > 0) {
        const bs = charsToBytes(t, r.start - 1);
        const be = charsToBytes(t, r.start);
        leftKeys = typesToKeys(featureTypesForRange(facetsRef.current, bs, be));
      }
      setActive(effectiveActive(leftKeys, pendingMarksRef.current));
    } else {
      const bs = charsToBytes(t, r.start);
      const be = charsToBytes(t, r.end);
      const map = {};
      for (const k of typesToKeys(featureTypesForRange(facetsRef.current, bs, be))) map[k] = true;
      setActive(map);
    }
  }, []);

  // Sync DOM ⇆ value. Skip when the incoming value is exactly what we just
  // emitted from typing (the DOM already reflects it) so the caret never
  // jumps mid-keystroke. Otherwise rebuild and restore the caret.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const incoming = serialize(text, facets);
    if (incoming === lastEmittedRef.current && pendingCaretRef.current == null) return;

    const html = valueToHtml(text, facets);
    const focused = editor === document.activeElement || editor.contains(document.activeElement);
    let restore = pendingCaretRef.current;
    if (restore == null && focused) {
      const r = getSelectionRange(editor);
      if (r) restore = { start: r.start, end: r.end };
    }
    if (editor.innerHTML !== html) editor.innerHTML = html;
    lastEmittedRef.current = incoming;
    if (restore != null && (focused || pendingCaretRef.current != null)) {
      const len = text.length;
      editor.focus();
      setSelectionRange(editor, Math.min(restore.start, len), Math.min(restore.end, len));
    }
    pendingCaretRef.current = null;
    refreshActive();
  }, [text, facets, refreshActive]);

  // Keep the toolbar in sync with the caret/selection while focused.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return undefined;
    const onSel = () => {
      const ae = document.activeElement;
      if (ae === editor || editor.contains(ae)) refreshActive();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [refreshActive]);

  const emit = useCallback((value, opts = {}) => {
    prevTextRef.current = value.text;
    if (opts.rewrite) {
      lastEmittedRef.current = null;
      pendingCaretRef.current = opts.caret || null;
    } else {
      lastEmittedRef.current = serialize(value.text, value.facets);
      pendingCaretRef.current = null;
    }
    onChangeRef.current(value);
  }, []);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const parsed = parseEditor(editor);
    const oldText = prevTextRef.current;
    const pending = pendingMarksRef.current;
    const pendingKeys = Object.keys(pending);

    if (pendingKeys.length && parsed.text.length > oldText.length) {
      const [is, ie] = insertedRange(oldText, parsed.text);
      const bs = charsToBytes(parsed.text, is);
      const be = charsToBytes(parsed.text, ie);
      let next = parsed.facets;
      for (const k of pendingKeys) {
        const type = FORMAT_TYPES[k];
        if (!type) continue;
        next = pending[k]
          ? applyFeatureAlways(next, bs, be, { $type: type })
          : removeFeatureAlways(next, bs, be, { $type: type });
      }
      emit({ text: parsed.text, facets: next }, { rewrite: true, caret: { start: ie, end: ie } });
    } else {
      emit({ text: parsed.text, facets: parsed.facets });
      refreshActive();
    }
  }, [emit, refreshActive]);

  const onToolbar = useCallback(
    (key) => {
      const editor = editorRef.current;
      if (!editor) return;
      const r = getSelectionRange(editor);
      const t = textRef.current;
      const f = facetsRef.current;
      if (r && !r.collapsed) {
        const bs = charsToBytes(t, r.start);
        const be = charsToBytes(t, r.end);
        pendingMarksRef.current = {};
        emit(
          { text: t, facets: toggleFeature(f, bs, be, { $type: FORMAT_TYPES[key] }) },
          { rewrite: true, caret: { start: r.start, end: r.end } },
        );
      } else {
        const on = !active[key];
        pendingMarksRef.current = { ...pendingMarksRef.current, [key]: on };
        editor.focus();
        refreshActive();
      }
    },
    [active, emit, refreshActive],
  );

  const onLink = useCallback(() => {
    const editor = editorRef.current;
    const r = getSelectionRange(editor);
    if (!r || r.collapsed) {
      window.alert('Select some text first, then add a link.');
      return;
    }
    const url = window.prompt('Link URL', 'https://');
    if (!url || url === 'https://') return;
    const t = textRef.current;
    const bs = charsToBytes(t, r.start);
    const be = charsToBytes(t, r.end);
    emit({ text: t, facets: applyLink(facetsRef.current, bs, be, url) }, {
      rewrite: true,
      caret: { start: r.start, end: r.end },
    });
  }, [emit]);

  const onUnlink = useCallback(() => {
    const editor = editorRef.current;
    const r = getSelectionRange(editor);
    if (!r || r.collapsed) return;
    const t = textRef.current;
    const bs = charsToBytes(t, r.start);
    const be = charsToBytes(t, r.end);
    emit({ text: t, facets: removeFeatureAlways(facetsRef.current, bs, be, { $type: LINK_TYPE }) }, {
      rewrite: true,
      caret: { start: r.start, end: r.end },
    });
  }, [emit]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (NAV_KEYS.has(e.key)) pendingMarksRef.current = {};
  }, []);

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const clip = e.clipboardData || window.clipboardData;
    const plain = clip ? clip.getData('text/plain') : '';
    if (plain) document.execCommand('insertText', false, plain);
  }, []);

  return (
    <div className="rich-text-field">
      <div className="rich-text-toolbar" role="toolbar" aria-label="Formatting">
        {FORMAT_BUTTONS.map((b) => (
          <ToolbarButton key={b.key} title={b.title} active={!!active[b.key]} onClick={() => onToolbar(b.key)}>
            {b.node}
          </ToolbarButton>
        ))}
        <ToolbarButton title="Add or replace link" active={!!active.link} disabled={!hasSelection} onClick={onLink}>
          🔗
        </ToolbarButton>
        <ToolbarButton title="Remove link" disabled={!hasSelection} onClick={onUnlink}>
          ⛓️‍💥
        </ToolbarButton>
      </div>
      <div
        ref={editorRef}
        className="admin-input rich-text-editable"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text"
        data-placeholder="Write…"
        style={{ minHeight: `${Math.max(2, rows) * 1.7}em` }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onMouseDown={() => {
          pendingMarksRef.current = {};
        }}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        onBlur={() => {
          pendingMarksRef.current = {};
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
      />
    </div>
  );
}

function ToolbarButton({ children, onClick, disabled, title, active }) {
  return (
    <button
      type="button"
      className={`rich-text-toolbar-btn${active ? ' is-active' : ''}`}
      // Keep the editor's focus/selection when clicking the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active ? 'true' : undefined}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

const NAV_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function serialize(text, facets) {
  return JSON.stringify([text, facets]);
}

function typesToKeys(types) {
  return types
    .map((t) => (t === LINK_TYPE ? 'link' : KEY_FOR_TYPE[t]))
    .filter(Boolean);
}

function effectiveActive(baseKeys, pending) {
  const map = {};
  for (const k of baseKeys) map[k] = true;
  for (const k of Object.keys(pending)) {
    if (pending[k]) map[k] = true;
    else delete map[k];
  }
  return map;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function valueToHtml(text, facets) {
  const runs = facetRuns(text, facets);
  if (runs.length === 0) return '';
  return runs.map((r) => spanHtml(r.text, r.features)).join('');
}

function spanHtml(runText, features) {
  const keys = [];
  let uri = '';
  for (const f of features || []) {
    if (f.$type === LINK_TYPE) {
      keys.push('link');
      uri = f.uri || '';
    } else if (KEY_FOR_TYPE[f.$type]) {
      keys.push(KEY_FOR_TYPE[f.$type]);
    }
  }
  const inner = escapeHtml(runText);
  if (keys.length === 0) return `<span>${inner}</span>`;
  const cls = keys.map((k) => `rt-${k}`).join(' ');
  const data = ` data-feat="${keys.join(',')}"${uri ? ` data-uri="${escapeAttr(uri)}"` : ''}`;
  return `<span class="${cls}"${data}>${inner}</span>`;
}

function featuresFromEl(el, inherited) {
  const feats = inherited.slice();
  const raw = el.dataset ? el.dataset.feat : '';
  const keys = raw ? raw.split(',').filter(Boolean) : [];
  for (const k of keys) {
    if (k === 'link') continue;
    const type = FORMAT_TYPES[k];
    if (type && !feats.some((f) => f.$type === type)) feats.push({ $type: type });
  }
  if (keys.includes('link') && el.dataset && el.dataset.uri) {
    if (!feats.some((f) => f.$type === LINK_TYPE)) feats.push({ $type: LINK_TYPE, uri: el.dataset.uri });
  }
  return feats;
}

function parseEditor(editor) {
  const runs = [];
  (function walk(node, inherited) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (child.data) runs.push({ text: child.data, features: inherited });
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') {
          runs.push({ text: '\n', features: inherited });
          continue;
        }
        walk(child, featuresFromEl(child, inherited));
      }
    }
  })(editor, []);
  const text = runs.map((r) => r.text).join('');
  return { text, facets: runsToFacets(text, runs) };
}

function insertedRange(oldText, newText) {
  let p = 0;
  const maxP = Math.min(oldText.length, newText.length);
  while (p < maxP && oldText[p] === newText[p]) p++;
  let s = 0;
  const maxS = Math.min(oldText.length - p, newText.length - p);
  while (s < maxS && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  return [p, newText.length - s];
}

/** Character offset from the editor's start to (container, offset). */
function getCharOffset(editor, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(editor);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function getSelectionRange(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!editor.contains(r.startContainer) || !editor.contains(r.endContainer)) return null;
  const a = getCharOffset(editor, r.startContainer, r.startOffset);
  const b = getCharOffset(editor, r.endContainer, r.endOffset);
  if (a == null || b == null) return null;
  return { start: Math.min(a, b), end: Math.max(a, b), collapsed: a === b };
}

function domPointAt(editor, target) {
  let remaining = Math.max(0, target);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
  let node;
  let last = null;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    last = node;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: editor, offset: 0 };
}

function setSelectionRange(editor, start, end) {
  const sp = domPointAt(editor, start);
  const ep = domPointAt(editor, end);
  const range = document.createRange();
  try {
    range.setStart(sp.node, sp.offset);
    range.setEnd(ep.node, ep.offset);
  } catch {
    return;
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
