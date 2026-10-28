/**
 * One section head (styles/controls.css .section-head): the title in 22px
 * semibold sentence case on a hairline, and `meta` (a count, a range, or a
 * control that belongs to the section) at the right of the same rule.
 * "36 SIGNATURES" is "Signatures … 36": the count is metadata, not the
 * heading.
 *
 * `as` sets the heading level (h2 by default) so the outline stays honest;
 * the look is the same at any level. `id` goes on the heading, for an
 * aria-labelledby on the section around it.
 */
export default function SectionHead({ title, meta = null, as: Heading = 'h2', id, className = '', children }) {
  return (
    <header className={`section-head ${className}`.trim()}>
      <Heading id={id} className="section-head-title">
        {title}
      </Heading>
      {meta != null && meta !== false && meta !== '' && <div className="section-head-meta">{meta}</div>}
      {children}
    </header>
  );
}
