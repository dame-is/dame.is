import { Fragment } from 'react';

/**
 * An identifier — an NSID, a DID, an at:// URI — with a line-break opportunity
 * after every `.`, `:` and `/`, so a long one wraps between its segments
 * (`net.anisota.chronicle.` | `expedition.camp`) instead of wherever the column
 * runs out (`net.anisota.chronicle.expeditio` | `n.camp`).
 *
 * `<wbr>` rather than a zero-width space: a ZWSP rides along when someone
 * copies the identifier, and a pasted NSID with invisible characters in it
 * quietly fails to match anything. Pair it with `overflow-wrap: anywhere` for
 * the rare segment that is wider than the column on its own.
 */
export default function BreakableId({ children }) {
  const text = String(children ?? '');
  const parts = text.match(/[^.:/]*[.:/]?/g).filter(Boolean);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <wbr />}
    </Fragment>
  ));
}
