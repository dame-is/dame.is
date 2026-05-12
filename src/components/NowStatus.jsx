import { Link } from 'react-router-dom';
import { useNowStatus } from '../hooks/useNowStatus.js';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import TickerText from './TickerText.jsx';

function compactRelative(value) {
  // "just now" → "now"; "5m ago" → "5m"; keeps the parenthetical short
  // so the bar reads like a sentence: "dame.is <status> (5m)".
  const full = relativeTime(value);
  if (!full) return '';
  if (full === 'just now') return 'now';
  return full.replace(/\s*ago$/, '');
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
      <TickerText className="chrome-signal-value" title={tooltip || undefined}>
        {href ? (
          <Link to={href} className="chrome-signal-link">{inner}</Link>
        ) : (
          inner
        )}
      </TickerText>
    </span>
  );
}
