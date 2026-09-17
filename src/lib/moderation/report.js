// The account report, rendered rather than written.
//
// A lookup is a form with the same nine fields every time. Handing that to a
// model costs a call, a couple of thousand tokens and a different shape on every
// answer, and buys prose where dame wanted a table. So this is a template with
// variables, filled from what score.js already computed, and no model runs.
//
// The template is editable from the portal. The VALUES are not, and one of them
// is dangerous: `displayName` is written by the account being looked at. A
// display name carrying a newline could forge a line of the report, and a forged
// "Band: PROTECTED" reads exactly like a field this code produced. Every
// substituted value is flattened to one line and capped before it is used.

/** What a lookup looks like unless dame changes it. */
export const DEFAULT_REPORT_TEMPLATE = [
  'Name: "{displayName}"',
  'Handle: @{handle}',
  'Band: {band}',
  'Distance: {distance}',
  'Relationship: {relationship}',
  'My Circle: {vouches}',
  'Reach: {followers} followers',
  'Age: {ageDays} days',
  'Cadence: Posting ~{postsPerDay}/day',
  'Lists: {lists}',
].join('\n');

/**
 * One line, bounded.
 *
 * Newlines are the attack: a field that can contain one can add a row to the
 * report that looks like this code wrote it. \p{C} covers control and format
 * characters together, which also catches the bidi overrides that can reorder
 * a line without adding anything visible to it. The cap is so a 300-character
 * display name cannot push the real fields out of a chat bubble.
 */
export function sanitiseField(value, { max = 64 } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const flat = String(value)
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '—';
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** How this account stands to dame, in words rather than three booleans. */
export function relationshipOf(a) {
  if (a.mutual) return 'Mutual';
  if (a.youFollow) return 'You follow them';
  if (a.followsYou) return 'They follow you';
  return 'Not mutual, not following, not followed';
}

/** Which of dame's lists already hold them. */
export function listsOf(a) {
  const on = [];
  if (a.alreadyListed) on.push('moderation list');
  if (a.protectedReason) on.push(`PROTECTED (${a.protectedReason})`);
  return on.length ? on.join(', ') : 'None';
}

/** Every variable a template may use. */
export function variablesFor(account) {
  const num = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—';
  return {
    handle: account.handle || account.did,
    did: account.did,
    displayName: account.displayName || '',
    band: account.band,
    trust: account.trust,
    distance: account.distance,
    vouches: account.vouches ?? 0,
    followers: num(account.followers),
    follows: num(account.follows),
    posts: num(account.posts),
    ageDays: num(account.ageDays),
    postsPerDay:
      typeof account.postsPerDay === 'number'
        ? account.postsPerDay.toFixed(0)
        : '—',
    relationship: relationshipOf(account),
    lists: listsOf(account),
    protectedReason: account.protectedReason || '',
  };
}

/**
 * Fill the template.
 *
 * An unknown {placeholder} is left alone rather than blanked, so a typo in the
 * portal shows up in the output instead of silently deleting a line.
 */
export function renderReport(
  account,
  { template = DEFAULT_REPORT_TEMPLATE } = {},
) {
  const vars = variablesFor(account);
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? sanitiseField(vars[key]) : whole,
  );
}

/**
 * What dame can do about this account, as parseable commands.
 *
 * PROTECTED gets no add option. The write would refuse it anyway, and a button
 * that exists to be rejected is worse than no button.
 */
export function actionsFor(account) {
  const at = `@${account.handle || account.did}`;
  const out = [];
  if (!account.protectedReason) {
    out.push({ label: `Add ${at} to the list`, command: `list add ${at}` });
  }
  out.push({
    label: `Remove ${at} from the list`,
    command: `list remove ${at}`,
  });
  return out;
}
