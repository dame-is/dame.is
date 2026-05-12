import { useNowStatus } from '../hooks/useNowStatus.js';
import { relativeTime } from '../lib/time.js';

export default function NowStatus() {
  const { record } = useNowStatus();
  const value = record?.value;
  const text = (value?.status || value?.text || '').trim();
  const ago = value?.createdAt ? relativeTime(value.createdAt) : '';
  return (
    <span className="chrome-signal chrome-signal-status" title={ago ? `${text} · ${ago}` : text}>
      <span className="chrome-signal-label">now</span>
      <span className="chrome-signal-value">
        {text ? <strong>{text}</strong> : '\u2014'}
      </span>
    </span>
  );
}
