-- The `unblock` schema on the atpota.to project: what /experimenting/unblocking
-- reads, and what the consumer on the droplet writes.
--
-- Run this once, in the SQL editor. Every statement is safe to run again.
--
-- WHAT IS HERE AND WHAT IS NOT. The consumer (services/unblock-consumer) keeps
-- every live block on the network in a SQLite file on the droplet, because it
-- has to: a deleted block names nobody, so the only way to know who was
-- unblocked is to have kept the block. That table is about 324,000 rows a day
-- and never comes here. What comes here is the result: one row for each pair
-- of accounts where one blocked the other and then stopped. The network
-- deletes about 8,400 blocks a day and only some of those can be placed, so
-- this is small. At the very most, with every delete placed, it grows by
-- about 2 MB a day.
--
-- AFTER RUNNING THIS, EXPOSE THE SCHEMA. PostgREST only serves schemas on its
-- list: Settings -> API -> Exposed schemas, add `unblock`. Until then every
-- call fails with PGRST106 ("Invalid schema: unblock") and the page says the
-- tracker isn't running. The mod schema's notes (mod-grants.sql) record that
-- this toggle has claimed to save and not saved before; if the error persists,
-- that file has the query that shows what PostgREST is really reading.
-- Exposing the schema grants nothing by itself: see the grants at the bottom.

create schema if not exists unblock;

-- One row per pair. `subject` is the account that was blocked and then
-- wasn't; `blocker` is the account that did both. The primary key is the pair,
-- so somebody who blocks and unblocks the same person ten times is one row
-- (the latest), and can't be ten entries on a leaderboard.
--
-- A row is deleted again if the blocker blocks the subject again: this is the
-- set of unblocks that still stand, not a log of every one that ever happened.
create table if not exists unblock.event (
  subject      text        not null,
  blocker      text        not null,
  blocked_at   timestamptz not null,
  unblocked_at timestamptz not null,
  primary key (subject, blocker)
);

-- For forgetting an account that has been deleted, which has to find it on
-- either side of a pair.
create index if not exists event_blocker on unblock.event (blocker);

-- One row, id 'consumer': what the consumer last said about itself. Since
-- when it has been watching, how far back it can still place an unblock, and
-- how many of the deletes it saw it could place.
create table if not exists unblock.status (
  id         text primary key,
  body       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- Row-level security on, with no policies: nothing but the service role reads
-- these, and it does so through the functions below.
alter table unblock.event enable row level security;
alter table unblock.status enable row level security;

-- ── writing ──────────────────────────────────────────────────────────────────

-- Apply a batch from the consumer's outbox, in order, and all or nothing.
--
--   { "op": "unblock", "subject", "blocker", "blockedAt", "unblockedAt" }
--       the block ended. Times are unix seconds.
--   { "op": "reblock", "subject", "blocker" }
--       they were blocked again; the unblock no longer stands.
--   { "op": "forget", "did" }
--       the account was deleted. Everything said about it goes, on both sides.
--
-- Every op leaves the same rows behind if it is applied twice, so a batch
-- whose reply was lost can simply be sent again. An op this function does not
-- know fails the whole batch on purpose: a consumer newer than this file
-- should stop and say so, not have its work quietly thrown away.
create or replace function unblock.ingest(ops jsonb, status jsonb default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  op jsonb;
  applied integer := 0;
begin
  for op in
    select t.value
    from jsonb_array_elements(coalesce(ops, '[]'::jsonb)) with ordinality as t(value, n)
    order by t.n
  loop
    case op->>'op'
      when 'unblock' then
        insert into unblock.event (subject, blocker, blocked_at, unblocked_at)
        values (
          op->>'subject',
          op->>'blocker',
          to_timestamp((op->>'blockedAt')::double precision),
          to_timestamp((op->>'unblockedAt')::double precision)
        )
        on conflict (subject, blocker) do update
          set blocked_at = excluded.blocked_at,
              unblocked_at = excluded.unblocked_at;
      when 'reblock' then
        delete from unblock.event
        where subject = op->>'subject' and blocker = op->>'blocker';
      when 'forget' then
        delete from unblock.event where subject = op->>'did';
        delete from unblock.event where blocker = op->>'did';
      else
        raise exception 'unblock.ingest: unknown op %', op->>'op';
    end case;
    applied := applied + 1;
  end loop;

  if status is not null then
    insert into unblock.status (id, body, updated_at)
    values ('consumer', status, now())
    on conflict (id) do update
      set body = excluded.body, updated_at = excluded.updated_at;
  end if;

  return applied;
end;
$$;

-- ── reading ──────────────────────────────────────────────────────────────────

-- The page's front: the consumer's status, how many unblocks stand, and the
-- accounts the most people have unblocked.
--
-- `min_seconds` leaves out a block that was undone almost as soon as it was
-- made. Blocking someone and unblocking them straight away is a way of
-- removing a follower (a "soft block"), and counting those would make this a
-- list of who gets soft-blocked the most. They are left out of the ranking and
-- still shown, labelled, to the person they happened to (see `lookup`).
--
-- This reads the whole table on every call. That is fine while the table is
-- small and the caller caches (api/unblocked.js asks the CDN to hold the
-- answer for five minutes). If it reaches a few million rows, turn the inner
-- select into a materialized view and refresh it on a schedule.
create or replace function unblock.board(min_seconds integer default 300, max_rows integer default 50)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', (
      select s.body || jsonb_build_object('publishedAt', s.updated_at)
      from unblock.status s
      where s.id = 'consumer'
    ),
    'unblocks', (select count(*) from unblock.event),
    'leaderboard', coalesce((
      select jsonb_agg(
        jsonb_build_object('did', t.subject, 'count', t.n, 'latest', t.latest)
        order by t.n desc, t.latest desc, t.subject
      )
      from (
        select e.subject, count(*) as n, max(e.unblocked_at) as latest
        from unblock.event e
        where e.unblocked_at - e.blocked_at >= make_interval(secs => min_seconds)
        group by e.subject
        order by n desc, latest desc, e.subject
        limit least(greatest(max_rows, 1), 200)
      ) t
    ), '[]'::jsonb)
  );
$$;

-- One account: how many people have unblocked it, how many of those were
-- quick (under `min_seconds`, so probably soft blocks), and the newest of
-- them with who and when.
create or replace function unblock.lookup(who text, min_seconds integer default 300, max_rows integer default 200)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'did', who,
    'total', (select count(*) from unblock.event e where e.subject = who),
    'quick', (
      select count(*)
      from unblock.event e
      where e.subject = who
        and e.unblocked_at - e.blocked_at < make_interval(secs => min_seconds)
    ),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('did', x.blocker, 'blockedAt', x.blocked_at, 'unblockedAt', x.unblocked_at)
        order by x.unblocked_at desc, x.blocker
      )
      from (
        select e.blocker, e.blocked_at, e.unblocked_at
        from unblock.event e
        where e.subject = who
        order by e.unblocked_at desc, e.blocker
        limit least(greatest(max_rows, 1), 500)
      ) x
    ), '[]'::jsonb)
  );
$$;

-- ── who may do what ──────────────────────────────────────────────────────────
--
-- A hand-made schema inherits none of the privileges Supabase sets up for
-- `public`, so the service role has to be given its way in. After this, the
-- service role (the site's server and the consumer) can call the three
-- functions, and anon and authenticated can do nothing here at all.
--
-- What keeps the other two roles out is that they hold no USAGE on the
-- schema, which is needed to name anything in it. That matters for the
-- functions: Postgres makes every new function executable by PUBLIC, and a
-- per-schema default can't take that away (checked: it only ever adds). So
-- the revoke on functions below covers the three that exist now, and a
-- function added later is still shut out by the schema, but should have this
-- block run again after it so the two agree.

grant usage on schema unblock to service_role;
grant all privileges on all tables in schema unblock to service_role;
grant execute on all functions in schema unblock to service_role;

revoke all on schema unblock from public, anon, authenticated;
revoke all on all tables in schema unblock from public, anon, authenticated;
revoke all on all functions in schema unblock from public, anon, authenticated;

alter default privileges in schema unblock grant all on tables to service_role;
alter default privileges in schema unblock grant execute on functions to service_role;

-- Verify. service_role should be true three times; anon and authenticated
-- false three times.
--
-- select r.rolname,
--        has_schema_privilege(r.rolname, 'unblock', 'USAGE') as schema_usage,
--        has_table_privilege(r.rolname, 'unblock.event', 'SELECT') as event_select,
--        has_function_privilege(r.rolname, 'unblock.board(integer, integer)', 'EXECUTE') as board_execute
-- from pg_roles r
-- where r.rolname in ('anon', 'authenticated', 'service_role');
