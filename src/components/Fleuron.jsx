import './Fleuron.css';

/**
 * The site's one ornament: the hedera ❧. It closes an essay, ends the home
 * ledger and stands in for a missing photograph, so a blank reads as a
 * printer's mark rather than an emoji or a broken-image glyph (IDN-12).
 *
 * Crimson Pro's Google Fonts subsets don't carry U+2767, so the glyph comes
 * from the reader's fallback font; one component keeps it swappable for a
 * drawn mark later without touching every place that uses it. Decorative, so
 * it is hidden from assistive tech: say what's missing in the surrounding
 * text instead.
 */
export default function Fleuron({ className = '' }) {
  return (
    <span className={`fleuron ${className}`.trim()} aria-hidden="true">
      &#x2767;
    </span>
  );
}
