function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function FeedLiveStatus({ refreshState, loadedAt, summary }) {
  const isRefreshing = refreshState === 'refreshing';
  const isError = refreshState === 'error';

  const timestamp = formatTime(loadedAt);
  const message = isRefreshing
    ? 'fetching live records…'
    : isError
      ? `live refresh failed · snapshot from ${timestamp}`
      : `refreshed ${timestamp}`;

  return (
    <p className="gutter feed-loaded-at feed-live-status-footer" aria-live="polite">
      {summary ? `${summary} · ` : ''}
      {message}
    </p>
  );
}
