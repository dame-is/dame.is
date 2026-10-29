/**
 * "Open in Apple Music" / "Search on Spotify" — the row of streaming links a
 * play or an album carries.
 *
 * `links` comes from `musicLinksFor` (one track) or `albumLinksFor` (a whole
 * release); both return the same shape, so a song's row and a record's row look
 * and read alike. `kind` is the honest part: `direct` means we know exactly
 * which thing on that service is meant, `search` means we are handing over a
 * query and letting the reader pick.
 *
 * Each is the kit's quiet button (controls.css .btn). A play's record page
 * doesn't use this row: its links join the record's own text actions instead
 * (AturiActions), so that page never stacks two button styles.
 */
export default function MusicServiceLinks({ links, label = 'Listen elsewhere' }) {
  if (!links?.length) return null;
  return (
    <ul className="music-links" aria-label={label}>
      {links.map((l) => (
        <li key={l.service} className={`music-link music-link-${l.service}`}>
          <a className="btn" href={l.url} target="_blank" rel="noreferrer noopener">
            {l.kind === 'direct' ? `Open in ${l.label}` : `Search on ${l.label}`}
          </a>
        </li>
      ))}
    </ul>
  );
}
