// Formatting for the hub: numbers, times, and how an account got on the list.
// Pure, so it is tested without rendering anything.

const nf = new Intl.NumberFormat('en-US');
const cf = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 8,889 */
export const fmt = (n) => (typeof n === 'number' ? nf.format(n) : '—');

/** 8.9K */
export const compact = (n) => (typeof n === 'number' ? cf.format(n) : '—');

/** $0.59, or <$0.01 for a cost too small to round to a cent. */
export const usd = (n) => {
  if (typeof n !== 'number') return '—';
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return n > 0 ? '<$0.01' : '$0';
};

/** "3h ago", "2d ago", "just now". */
export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** "Oct 1, 2026" */
export function day(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** How long an account has existed: "4y", "7mo", "12d". */
export function age(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const days = (now - t) / 86_400_000;
  if (days < 60) return `${Math.max(1, Math.round(days))}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

export const profileUrl = (actor) =>
  `https://bsky.app/profile/${String(actor || '').replace(/^@/, '')}`;

/** Split an approved_via into what it was based on and whether the agent did it. */
function readVia(via) {
  const agent = via === 'agent' || via.startsWith('agent:');
  // A watched post adds on its own when dame asked it to: "watch:triage:hostile".
  const watch = via.startsWith('watch:');
  return { agent, watch, basis: via.replace(/^(agent|watch):?/, '') };
}

/** How an account was put on the list, as a sentence. */
export function viaText(via) {
  if (!via) return 'carried over in the September migration';
  const { agent, watch, basis } = readVia(via);
  const what = basis.startsWith('triage:')
    ? `read as ${basis.slice(7)} by triage`
    : basis === 'band'
      ? 'a band approval on a scanned post'
      : basis === 'individual'
        ? 'picked by name from a scan'
        : basis === 'command' || basis === ''
          ? 'a direct block'
          : basis === 'portal'
            ? 'restored from this hub'
            : basis;
  if (watch) return `${what}, while watching a post`;
  return agent ? `${what}, done by the agent` : what;
}

/** How an account was put on the list, as a short tag. */
export function viaTag(via) {
  if (!via) return null;
  const { agent, watch, basis } = readVia(via);
  const text = basis.startsWith('triage:')
    ? basis.slice(7)
    : basis === 'individual'
      ? 'by name'
      : basis === 'command' || !basis
        ? 'direct'
        : basis;
  return {
    text: watch ? `${text} · watch` : agent ? `${text} · agent` : text,
    tone: basis === 'triage:hostile' ? 'danger' : 'plain',
  };
}
