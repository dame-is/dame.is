import { describe, it, expect } from 'vitest';
import { highlightCode } from './highlight.js';

describe('highlightCode', () => {
  it('reads JSX under js, jsx and react alike', () => {
    const src = 'const a = <Card title="x" />;';
    const js = highlightCode(src, 'js');
    expect(js).toContain('hljs-keyword');
    expect(highlightCode(src, 'jsx')).toBe(js);
    expect(highlightCode(src, 'react')).toBe(js);
  });

  it('answers to html as well as xml', () => {
    expect(highlightCode('<p class="a">hi</p>', 'html')).toContain('hljs-tag');
  });

  it('falls back to the four grammars for an unknown or missing language', () => {
    const out = highlightCode('{"a": 1}', 'python');
    expect(out).toContain('hljs-');
    expect(highlightCode('a { color: red; }', '')).toContain('hljs-');
  });
});
