import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useNowPlaying } from '../hooks/useNowPlaying.js';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import TickerText from './TickerText.jsx';
import { xrayRecordAttrs } from '../lib/xray.js';

// Memoised: it takes no props, and the top chrome around it re-renders as the
// page scrolls.
export default memo(function NowPlaying() {
  const play = useNowPlaying();
  if (!play?.track) {
    return (
      <span className="chrome-signal chrome-signal-now-playing">
        <span className="chrome-signal-label">listening to</span>
        <span className="chrome-signal-value">&mdash;</span>
      </span>
    );
  }
  // A live `fm.teal.actor.status` means the song is playing right now, so the
  // tooltip says so instead of dating it — "3 minutes ago" under-sells a track
  // that hasn't finished.
  const when = play.live ? 'now playing' : play.playedAt ? relativeTime(play.playedAt) : '';
  const tooltip = `${play.track}${play.artist ? ' by ' + play.artist : ''}${when ? ' · ' + when : ''}`;
  const href = recordPathFromAtUri(play.atUri);
  // A play that isn't live says how long ago it was, inline, like the status
  // line above it: on a phone there is no hover to show the tooltip, so the
  // last thing played yesterday evening read as what's playing now.
  const inner = (
    <>
      <strong>{play.track}</strong>
      {play.artist ? ` by ${play.artist}` : ''}
      {!play.live && when ? (
        <span className="chrome-signal-meta">{when}</span>
      ) : null}
    </>
  );
  return (
    <span className="chrome-signal chrome-signal-now-playing" {...xrayRecordAttrs(play.atUri)}>
      <span className="chrome-signal-label">listening to</span>
      <TickerText className="chrome-signal-value" title={tooltip}>
        {href ? (
          <Link to={href} className="chrome-signal-link">{inner}</Link>
        ) : (
          inner
        )}
      </TickerText>
    </span>
  );
});
