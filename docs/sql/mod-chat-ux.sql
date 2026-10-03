-- The chat UX pass: what each account did on a post, whether it was already
-- listed or already blocks dame, confirmations that a 👍 can run, watched posts,
-- notes dame asked the bot to remember, and alerts on dame's own posts.
--
-- Applied 2026-10-01 as the migration `mod_chat_ux`. All additive: three
-- nullable columns, one nullable column, three new tables. See "Talking to it"
-- in docs/MODERATION.md.

-- Per account on a scanned post. `engaged` is the harvest's engagement kinds
-- (like, repost, quote, reply, threadReply), so "the likers" of a whole-post
-- scan can be told apart without harvesting again. The two flags are as of the
-- scan; an approval checks the list again before writing.
alter table mod.decision
  add column if not exists engaged text[],
  add column if not exists already_listed boolean,
  add column if not exists blocks_me boolean;

-- A change the bot asked about and a "yes" or a 👍 runs, exactly as described:
-- { commands: [...], describe: '...', message_ids: [...], created_at: '...' }.
alter table mod.dm_choice
  add column if not exists pending jsonb;

-- A post dame asked the bot to keep reading. `mode` ask holds what it finds for
-- a 👍; auto adds what two models agree is hostile and says so in the digest.
create table if not exists mod.watch (
  id uuid primary key default gen_random_uuid(),
  convo_id text not null,
  uri text not null,
  plan_id uuid,
  mode text not null default 'ask' check (mode in ('ask', 'auto')),
  created_at timestamptz not null default now(),
  until timestamptz not null,
  stopped_at timestamptz,
  last_checked_at timestamptz,
  last_digest_at timestamptz,
  stats jsonb not null default '{}'::jsonb
);
create index if not exists watch_live on mod.watch (until) where stopped_at is null;

-- "remember: ..." from dame's own message, word for word. Read into the agent's
-- prompt beside the standing instructions from the config record, which the bot
-- cannot write; these it can, and only from dame's literal text.
create table if not exists mod.memory (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

-- dame's own recent posts, for noticing one that is suddenly drawing quotes.
create table if not exists mod.post_alert (
  uri text primary key,
  last_count integer,
  last_seen_at timestamptz,
  alerted_at timestamptz
);

-- Same posture as every other mod table: RLS on, no policies, service_role only.
alter table mod.watch enable row level security;
alter table mod.memory enable row level security;
alter table mod.post_alert enable row level security;
revoke all on mod.watch, mod.memory, mod.post_alert from anon, authenticated;
grant all on mod.watch, mod.memory, mod.post_alert to service_role;

-- 2026-10-03, applied as `mod_dm_choice_options_default`. `options` was NOT NULL
-- with no default, and PostgREST's upsert inserts the payload's columns only,
-- so every write that left it out failed the constraint before ON CONFLICT
-- could merge: storing a 👍 question, clearing one, and remembering the last
-- post sent (the last of those had been failing silently since it was
-- written). With a default, a partial write keeps whatever options are there.
alter table mod.dm_choice alter column options set default '[]'::jsonb;
