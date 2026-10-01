import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_TAB,
  LEGACY_TABS,
  TAB_KEYS,
  paramsForRoute,
  routeFromParams,
} from './routes.js';
import { age, timeAgo, usd, viaTag, viaText } from './format.js';
import { tokenExpiry } from '../../lib/moderation/client.js';

const route = (qs) => routeFromParams(new URLSearchParams(qs));

describe('where the hub opens', () => {
  it('opens on the queue when the URL says nothing', () => {
    expect(route('view=moderation').tab).toBe('queue');
    expect(DEFAULT_TAB).toBe('queue');
  });

  it('lands somewhere real for a tab that does not exist', () => {
    expect(route('tab=migrate').tab).toBe(DEFAULT_TAB);
  });

  it('keeps every link an old DM can carry working', () => {
    // planLink, whyLink and listLink in src/lib/moderation/links.js build
    // these; the bot has been putting them in DMs for weeks.
    for (const [old, now] of Object.entries(LEGACY_TABS)) {
      expect(TAB_KEYS).toContain(now);
      expect(route(`tab=${old}`).tab).toBe(now);
    }
    expect(
      route('tab=plans&code=6fa2491d&label=hostile&state=pending'),
    ).toMatchObject({
      tab: 'activity',
      plan: '6fa2491d',
      planFilters: { label: 'hostile', state: 'pending', band: '' },
    });
    expect(route('tab=why&actor=someone.bsky.social')).toMatchObject({
      tab: 'blocked',
      account: 'someone.bsky.social',
    });
  });

  it('writes its own params and leaves the router its own', () => {
    const q = paramsForRoute('view=moderation&hour=14&tab=why&actor=x', {
      tab: 'activity',
      plan: '3f9a2c1b',
      account: null,
    });
    expect(q.get('view')).toBe('moderation');
    expect(q.get('hour')).toBe('14');
    expect(q.get('tab')).toBe('activity');
    expect(q.get('code')).toBe('3f9a2c1b');
    expect(q.has('actor')).toBe(false);
    // The default tab is left out of the URL rather than written.
    expect(paramsForRoute('view=moderation', { tab: 'queue' }).has('tab')).toBe(
      false,
    );
  });

  it('round-trips: a route written to the URL reads back as itself', () => {
    const r = { tab: 'blocked', plan: null, account: 'did:plc:abc' };
    expect(routeFromParams(paramsForRoute('view=moderation', r))).toMatchObject(
      r,
    );
  });

  it('renders a view for every tab in the bar', () => {
    // The old hub shipped tabs with no panel and panels with no tab, because
    // the bar and the switch were two lists. Both now come from TAB_KEYS; this
    // checks the switch actually has a branch for each.
    const source = readFileSync(
      fileURLToPath(new URL('./ModerationApp.jsx', import.meta.url)),
      'utf8',
    );
    for (const key of TAB_KEYS) {
      expect(source).toMatch(new RegExp(`route\\.tab === '${key}'`));
    }
  });
});

describe('how an account got on the list', () => {
  it('reads every approved_via the system writes', () => {
    expect(viaText(null)).toMatch(/migration/);
    expect(viaText('band')).toMatch(/band approval/);
    expect(viaText('individual')).toMatch(/by name/);
    expect(viaText('triage:hostile')).toBe('read as hostile by triage');
    expect(viaText('command')).toBe('a direct block');
    expect(viaText('agent')).toBe('a direct block, done by the agent');
    expect(viaText('agent:triage:hostile')).toBe(
      'read as hostile by triage, done by the agent',
    );
    expect(viaText('portal')).toMatch(/restored/);
    // A watched post that was asked to add the hostile ones on its own.
    expect(viaText('watch:triage:hostile')).toBe(
      'read as hostile by triage, while watching a post',
    );
    expect(viaTag('watch:triage:hostile')).toEqual({
      text: 'hostile · watch',
      tone: 'danger',
    });
  });

  it('tags a hostile reading as the one that matters', () => {
    expect(viaTag('triage:hostile')).toEqual({
      text: 'hostile',
      tone: 'danger',
    });
    expect(viaTag('agent:individual')).toEqual({
      text: 'by name · agent',
      tone: 'plain',
    });
    expect(viaTag(null)).toBe(null);
  });
});

describe('formatting', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('says how long ago in the unit a person would', () => {
    expect(timeAgo('2026-10-01T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-01T11:15:00Z', now)).toBe('45m ago');
    expect(timeAgo('2026-09-30T12:00:00Z', now)).toBe('24h ago');
    expect(timeAgo('2026-09-21T12:00:00Z', now)).toBe('10d ago');
    expect(timeAgo('not a date', now)).toBe('');
  });

  it('says how old an account is', () => {
    expect(age('2026-09-20T12:00:00Z', now)).toBe('11d');
    expect(age('2025-10-01T12:00:00Z', now)).toBe('12mo');
    expect(age('2022-10-01T12:00:00Z', now)).toBe('4y');
  });

  it('prices to the cent and admits when it cannot', () => {
    expect(usd(0.5943)).toBe('$0.59');
    expect(usd(12.3)).toBe('$12.30');
    expect(usd(0.0004)).toBe('<$0.01');
    expect(usd(0)).toBe('$0');
    expect(usd(undefined)).toBe('—');
  });
});

describe('the cached service-auth token', () => {
  const jwt = (payload) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

  it('reads the expiry so a token can be reused until just before it', () => {
    expect(tokenExpiry(jwt({ exp: 1_790_000_000 }))).toBe(1_790_000_000_000);
  });

  it('treats an unreadable token as already expired', () => {
    expect(tokenExpiry('garbage')).toBe(0);
    expect(tokenExpiry(jwt({ iss: 'x' }))).toBe(0);
  });
});
