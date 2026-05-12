import { useNowPlaying } from '../hooks/useNowPlaying.js';
import { relativeTime } from '../lib/time.js';

export default function NowPlaying() {
  const play = useNowPlaying();
  if (!play?.track) {
    return (
      <span className="chrome-signal chrome-signal-now-playing">
        <span className="chrome-signal-label">listening</span>
        <span className="chrome-signal-value">&mdash;</span>
      </span>
    );
  }
  const ago = play.playedAt ? relativeTime(play.playedAt) : '';
  const label = `${play.track}${play.artist ? ' · ' + play.artist : ''}${ago ? ' · ' + ago : ''}`;
  const inner = (
    <>
      <strong>{play.track}</strong>
      {play.artist ? ` · ${play.artist}` : ''}
    </>
  );
  return (
    <span className="chrome-signal chrome-signal-now-playing" title={label}>
      <span className="chrome-signal-label">listening</span>
      <span className="chrome-signal-value">
        {play.originUrl ? (
          <a href={play.originUrl} target="_blank" rel="noreferrer noopener">{inner}</a>
        ) : (
          inner
        )}
      </span>
    </span>
  );
}
