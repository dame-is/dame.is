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
  // The way to LEARN something before acting. The band answers "who would
  // notice if I blocked them" and says nothing at all about conduct, which is
  // the question a person is usually actually asking. Offering the read beside
  // the act is what keeps the band from being read as a verdict by default.
  out.push({
    label: `Read ${at}'s recent posts first`,
    command: `read ${at}`,
  });
  return out;
}

/** What a post scan looks like unless dame changes it. */
export const DEFAULT_PLAN_TEMPLATE = [
  'Post by @{author} ({authorBand})',
  '{uri}',
  '',
  'Participants: {participants}',
  'Engagements: {engagements}',
  '',
  'PROTECTED: {PROTECTED}',
  'CONNECTED: {CONNECTED}',
  'PERIPHERAL: {PERIPHERAL}',
  'NOTABLE: {NOTABLE}',
  'UNKNOWN: {UNKNOWN}',
  '',
  'Need a look: {needsLook}',
  'Plan: {code}',
  'If you add all: {cost}',
].join('\n');

/** Every variable a post-scan template may use. */
export function planVariablesFor(plan) {
  const byBand = plan.byBand || {};
  const needsLook = Object.entries(byBand)
    .filter(([b, n]) => b !== 'UNKNOWN' && n)
    .map(([b, n]) => `${n} ${b}`)
    .join(', ');
  const engagements = Object.entries(plan.engagements || {})
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  return {
    uri: plan.uri,
    code: plan.code,
    kind: plan.kind,
    author: plan.author?.handle || plan.author?.did || 'unknown',
    authorBand: plan.author?.band || 'UNSCORED',
    authorVouches: plan.author?.vouches ?? 0,
    authorFollowers: plan.author?.followers ?? null,
    participants: plan.total,
    engagements: engagements || '—',
    needsLook: needsLook || 'none',
    truncated: plan.truncated ? 'yes, the harvest hit a page cap' : 'no',
    cost: plan.cost || '',
    ...byBand,
  };
}

/** Fill the post-scan template. Unknown placeholders survive, as above. */
export function renderPlanReport(
  plan,
  { template = DEFAULT_PLAN_TEMPLATE } = {},
) {
  const vars = planVariablesFor(plan);
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    key in vars ? sanitiseField(vars[key], { max: 120 }) : whole,
  );
}

/**
 * What dame can do about a scanned post.
 *
 * Bands with nothing in them get no option: an approval that would carry zero
 * accounts is a button that does nothing, and a menu of those teaches you to
 * stop reading the menu.
 */
export function planActions(plan) {
  const byBand = plan.byBand || {};
  const out = [];

  // THE AUTHOR LEADS. A post with no likes and no replies scored every band at
  // zero and offered only "Do nothing", which is a true report about the graph
  // around the post and a useless one about the post: the account in front of
  // dame is the one who WROTE it. PROTECTED gets no add option here for the
  // same reason it gets none in actionsFor.
  const author = plan.author;
  const at = author ? `@${author.handle || author.did}` : null;
  if (at && !author.protectedReason) {
    out.push({
      label: `Add the author ${at} to the list`,
      command: `list add ${at}`,
    });
  }
  if (at) {
    out.push({
      label: `Read ${at}'s recent posts first`,
      command: `read ${at}`,
    });
  }

  if (byBand.UNKNOWN) {
    out.push({
      label: `Add the ${byBand.UNKNOWN} UNKNOWN accounts`,
      command: `approve ${plan.code} UNKNOWN`,
    });
  }
  const named = Object.entries(byBand)
    .filter(([b, n]) => b !== 'UNKNOWN' && b !== 'PROTECTED' && n)
    .reduce((t, [, n]) => t + n, 0);
  if (named) {
    out.push({
      label: `Show me the ${named} that need a look`,
      command: `review ${plan.code}`,
    });
    out.push({
      label: `Add all ${plan.total - (byBand.PROTECTED || 0)}, every band`,
      command: `approve ${plan.code} ${Object.keys(byBand)
        .filter((b) => b !== 'PROTECTED' && byBand[b])
        .join(',')}`,
    });
  }
  out.push({ label: 'Do nothing', command: `cancel ${plan.code}` });
  return out;
}
