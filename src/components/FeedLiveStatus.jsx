function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FeedLiveStatus({ refreshState, loadedAt, variant, summary }) {
  const isRefreshing = refreshState === 'refreshing';
  const isError = refreshState === 'error';

  const dotClass =
    'feed-live-dot' +
    (isRefreshing ? ' feed-live-dot-pulse' : '') +
    (isError ? ' feed-live-dot-error' : '');

  if (variant === 'top') {
    const label = isRefreshing ? 'Updating…' : isError ? 'Offline' : 'Live';
    return (
      <div className="feed-live-status feed-live-status-top" aria-live="polite">
        <span className={dotClass} aria-hidden="true" />
        <span className="feed-live-label">{label}</span>
      </div>
    );
  }

  // footer
  const timestamp = formatTime(loadedAt);
  const message = isRefreshing
    ? 'fetching live records…'
    : isError
      ? `live refresh failed · snapshot from ${timestamp}`
      : `refreshed ${timestamp}`;

  return (
    <p
      className="gutter feed-loaded-at feed-live-status feed-live-status-footer"
      aria-live="polite"
    >
      <span className={dotClass} aria-hidden="true" />
      <span>
        {summary ? `${summary} · ` : ''}
        {message}
      </span>
    </p>
  );
}
