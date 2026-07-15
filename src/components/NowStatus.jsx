import { Link } from 'react-router-dom';
import { useNowStatus } from '../hooks/useNowStatus.js';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import TickerText from './TickerText.jsx';

function compactRelative(value) {
  // "just now" stays as-is; everything else keeps the "ago" suffix so
  // the bar reads like "dame.is <status> 5m ago" instead of the
  // ambiguous "5m" which could be read as a future time.
  const full = relativeTime(value);
  if (!full) return '';
  return full;
}

export default function NowStatus() {
  const { record } = useNowStatus();
  const value = record?.value;
  const text = (value?.status || value?.text || '').trim();
  const ago = value?.createdAt ? compactRelative(value.createdAt) : '';
  const fullAgo = value?.createdAt ? relativeTime(value.createdAt) : '';
  const tooltip = fullAgo ? `${text} · ${fullAgo}` : text;
  const href = recordPathFromAtUri(record?.uri);
  const inner = (
    <>
      {text ? <strong>{text}</strong> : '\u2014'}
        {text && ago ? <span className="chrome-signal-meta">{ago}</span> : null}
    </>
  );
  return (
    <span className="chrome-signal chrome-signal-status">
      <TickerText className="chrome-signal-value" title={tooltip || undefined} marquee>
        {href ? (
          <Link to={href} className="chrome-signal-link">{inner}</Link>
        ) : (
          inner
        )}
      </TickerText>
    </span>
  );
}
