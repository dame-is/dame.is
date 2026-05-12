import { useNowStatus } from '../hooks/useNowStatus.js';
import { relativeTime } from '../lib/time.js';
import TickerText from './TickerText.jsx';

export default function NowStatus() {
  const { record } = useNowStatus();
  const value = record?.value;
  const text = (value?.status || value?.text || '').trim();
  const ago = value?.createdAt ? relativeTime(value.createdAt) : '';
  const tooltip = ago ? `${text} · ${ago}` : text;
  return (
    <span className="chrome-signal chrome-signal-status">
      <span className="chrome-signal-label">now</span>
      <TickerText className="chrome-signal-value" title={tooltip || undefined}>
        {text ? <strong>{text}</strong> : '\u2014'}
      </TickerText>
    </span>
  );
}
