import { Link } from 'react-router-dom';
import { useNowPlaying } from '../hooks/useNowPlaying.js';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import TickerText from './TickerText.jsx';

export default function NowPlaying() {
  const play = useNowPlaying();
  if (!play?.track) {
    return (
      <span className="chrome-signal chrome-signal-now-playing">
        <span className="chrome-signal-label">listening to</span>
        <span className="chrome-signal-value">&mdash;</span>
      </span>
    );
  }
  const ago = play.playedAt ? relativeTime(play.playedAt) : '';
  const tooltip = `${play.track}${play.artist ? ' · ' + play.artist : ''}${ago ? ' · ' + ago : ''}`;
  const href = recordPathFromAtUri(play.atUri);
  const inner = (
    <>
      <strong>{play.track}</strong>
      {play.artist ? ` · ${play.artist}` : ''}
    </>
  );
  return (
    <span className="chrome-signal chrome-signal-now-playing">
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
}
