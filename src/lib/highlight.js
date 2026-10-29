// The syntax highlighter for code blocks in essays, loaded on demand by
// LeafletDocument's CodeBlock. Only the languages the site ever shows are
// registered: HTML, JSON, CSS and JavaScript, which highlight.js also reads
// JSX with. `highlight.js/lib/common` carried about forty grammars, a 54 KB
// (gzip) chunk for four of them.
import hljs from 'highlight.js/lib/core';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
// The grammars already answer to html, js and jsx; a block tagged "react"
// is JSX too.
hljs.registerAliases(['react'], { languageName: 'javascript' });

const LANGUAGES = ['xml', 'json', 'css', 'javascript'];

/** Highlighted HTML for `code`: in `lang` when it's one of ours, otherwise
 *  whichever of the four reads best. */
export function highlightCode(code, lang) {
  return lang && hljs.getLanguage(lang)
    ? hljs.highlight(code, { language: lang }).value
    : hljs.highlightAuto(code, LANGUAGES).value;
}
