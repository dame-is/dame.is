import { describe, it, expect } from 'vitest';
import { groupWaypoints, resolveWaypoints } from './waypoints.js';

const POST = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3mz2fz5u3qk2a';
const DOC = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/site.standard.document/3mz4bbmjphc2l';

const names = (list) => list.map((w) => w.name);

describe('the waypoint policy', () => {
  it('lists the forks together, never among the recommendations', async () => {
    const { recommended, groups } = groupWaypoints(await resolveWaypoints(POST));
    expect(names(recommended)).toEqual(['Bluesky', 'Anisota']);
    const forks = groups.find((g) => g.id === 'blueskyForks');
    expect(names(forks.waypoints).sort()).toEqual(['Blacksky', 'Mu', 'Northsky']);
  });

  it('offers the Bluesky clients and the explorer for a post, and nothing else', async () => {
    const { recommended, groups } = groupWaypoints(await resolveWaypoints(POST));
    const all = [...recommended, ...groups.flatMap((g) => g.waypoints)];
    expect(names(all).sort()).toEqual(
      ['Anisota', 'Aturi Explore', 'Blacksky', 'Bluesky', 'Impro', 'Mu', 'Northsky', 'Red Dwarf'].sort(),
    );
  });

  it('keeps Bluesky clients off a document', async () => {
    const result = await resolveWaypoints(DOC);
    expect(names(result.waypoints).sort()).toEqual(['Anisota Reader', 'Aturi Explore', 'Leaflet']);
  });
});
