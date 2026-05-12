export default function StatusEntry({ payload, atUri }) {
  const text = (payload?.status || payload?.text || '').trim();
  return (
    <article className="status-entry feed-card" data-at-uri={atUri}>
      <p className="status-entry-text">
        <span className="small-caps status-entry-prefix">dame.is</span>{' '}
        <span className="status-entry-body">{text || <em>—</em>}</span>
      </p>
    </article>
  );
}
