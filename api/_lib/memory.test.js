import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = { memory: [] };
vi.mock('./modDb.js', () => ({
  select: vi.fn(async () => db.memory.filter((n) => !n.removed_at)),
  upsert: vi.fn(async (_t, rows) => {
    for (const r of rows)
      db.memory.push({ id: `n${db.memory.length + 1}`, ...r });
  }),
  update: vi.fn(async (_t, { eq }, patch) => {
    Object.assign(
      db.memory.find((n) => n.id === eq.id),
      patch,
    );
  }),
}));

const { remember, forget, listNotes, recallText, notesBlock, MAX_NOTES } =
  await import('./memory.js');

beforeEach(() => {
  db.memory.length = 0;
});

describe('notes from the chat', () => {
  it("keeps dame's words, once, and numbers them", async () => {
    expect((await remember('never block people who only liked')).ok).toBe(true);
    expect(
      (await remember('Never block people who only liked')).message,
    ).toMatch(/already had/);
    await remember('ask before blocking anyone CONNECTED');
    const notes = await listNotes();
    expect(recallText(notes)).toContain(
      '2. ask before blocking anyone CONNECTED',
    );
    expect(notesBlock(notes)).toContain("in dame's own words");
  });

  it('forgets by number or by words, and refuses an ambiguous match', async () => {
    await remember('skip likers');
    await remember('skip reposters');
    expect((await forget({ text: 'skip' })).ok).toBe(false);
    expect((await forget({ index: 2 })).message).toBe(
      'Forgotten: "skip reposters"',
    );
    expect((await listNotes()).map((n) => n.text)).toEqual(['skip likers']);
  });

  it('holds a bounded number', async () => {
    for (let i = 0; i < MAX_NOTES; i += 1) await remember(`note ${i}`);
    expect((await remember('one more')).ok).toBe(false);
  });
});
