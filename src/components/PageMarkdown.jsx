import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown.js';

/**
 * A page record's body (usePageContent's `body` and `bodyFormat`), rendered.
 * Its own module so a surface that shows one only on demand can load marked
 * then rather than with the entry: the chrome's info sheet, which imports it
 * lazily.
 */
export default function PageMarkdown({ body, format, className }) {
  const html = useMemo(() => renderMarkdown(body, format), [body, format]);
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
