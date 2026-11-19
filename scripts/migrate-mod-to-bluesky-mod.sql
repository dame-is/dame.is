-- Move the moderation history from the `mod` schema into bluesky-mod.
--
-- One transaction, inside the same database, so nothing leaves Supabase and a
-- failure changes nothing. Run it once, into a schema bluesky-mod has created
-- and not yet used, with the old consumer and the bot both stopped:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v target=bluesky_mod \
--     -v list_uri='at://did:plc:…/app.bsky.graph.list/…' \
--     -f scripts/migrate-mod-to-bluesky-mod.sql
--
-- `target` is bluesky-mod's DATABASE_SCHEMA. `list_uri` is MOD_LIST_URI, the
-- list on the bot account. docs/MODERATION-MOVE.md has the whole cutover.
--
-- What comes across: every plan and decision, the protected set, the newest
-- four finished re-scores of the list and the newest brief (so the weekly
-- rhythm and its baseline carry on), the review queue's keeps, model token
-- counts, alerts, watches (stopped), the DM cursor, and the accounts carried
-- over from the old personal list in September, as one plan.
--
-- What does not: the follow-graph snapshot (bluesky-mod builds its own in
-- minutes), the bot's session (it logs in fresh, so two processes never
-- share a refresh token), old DM menus, and the finished list migration's own
-- bookkeeping.

\if :{?target}
\else
  \set target bluesky_mod
\endif
\if :{?list_uri}
\else
  \echo 'Set list_uri: -v list_uri=at://did:plc:…/app.bsky.graph.list/…'
  \quit
\endif

begin;

set local search_path = :"target";
select set_config('migrate.list_uri', :'list_uri', true);

-- bluesky-mod compares times as text, so every one is written the way
-- JavaScript's toISOString writes it.
create function pg_temp.iso(t timestamptz) returns text
  language sql immutable
  as $$ select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Refuse to run anywhere but a fresh bluesky-mod schema, with the bot stopped.
do $$
begin
  if to_regclass('decision') is null or to_regclass('review_keep') is null then
    raise exception 'No bluesky-mod tables in %. Start bluesky-mod against it once (or npm run setup) so it makes them, then stop it.',
      current_setting('search_path');
  end if;
  if current_schema() = 'mod' then
    raise exception 'target is the old schema; set it to bluesky-mod''s DATABASE_SCHEMA';
  end if;
  if exists (select 1 from plan) or exists (select 1 from decision) then
    raise exception 'The target already has plans or decisions. This import runs once, into a schema bluesky-mod has not used yet.';
  end if;
  if exists (select 1 from lease where heartbeat_at > pg_temp.iso(now() - interval '90 seconds')) then
    raise exception 'bluesky-mod is running against this schema. Stop it first.';
  end if;
  if current_setting('migrate.list_uri') !~ '^at://did:[a-z]+:[^/]+/app\.bsky\.graph\.list/[^/]+$' then
    raise exception 'list_uri is not a list''s at:// URI: %', current_setting('migrate.list_uri');
  end if;
end $$;

-- Plans keep their ids, so every code the bot ever sent still works. A null
-- list means MOD_LIST_URI.
insert into plan (id, created_at, approved_at, approved_bands, totals, note, list_uri)
select id::text, pg_temp.iso(created_at), pg_temp.iso(approved_at),
       to_jsonb(approved_bands), totals, note, null
from mod.plan;

insert into decision (plan_id, did, band, trust, distance, vouches, action, acted_at,
                      undone_at, undo_reason, approved_via, triage, triage_quote, triage_at,
                      triage_model, evidence_uri, engaged, already_listed, blocks_me)
select plan_id::text, did, coalesce(band, 'UNSCORED'), trust, distance, vouches, action,
       pg_temp.iso(acted_at), pg_temp.iso(undone_at), undo_reason, approved_via, triage,
       triage_quote, pg_temp.iso(triage_at), triage_model, evidence_uri, to_jsonb(engaged),
       -- In bluesky-mod, already_listed on an add that was made means "a
       -- typed block that wrote nothing". The old bot never logged those, but
       -- a scan's flag could survive on a row added later by name.
       case when action = 'list_add' and acted_at is not null then false else already_listed end,
       blocks_me
from mod.decision;

-- The accounts carried over from the old personal list, as one plan, so
-- "why are they on the list" has an answer for them too.
with carried as (
  select i.did, i.band, i.carried_at, m.carry_bands, m.source_list
  from mod.migration_item i
  cross join lateral (select carry_bands, source_list from mod.migration order by id limit 1) m
  where i.carried_at is not null and i.error is null
),
made as (
  insert into plan (id, created_at, approved_at, approved_bands, totals, note, list_uri)
  select gen_random_uuid()::text, pg_temp.iso(min(carried_at)), pg_temp.iso(min(carried_at)),
         to_jsonb(min(carry_bands)), null,
         'carried over from the old list when it moved to the bot account', null
  from carried
  having count(*) > 0
  returning id
)
insert into decision (plan_id, did, band, action, acted_at, approved_via, already_listed)
select made.id, c.did, coalesce(c.band, 'UNSCORED'), 'list_add', pg_temp.iso(c.carried_at), 'band', false
from carried c cross join made;

-- The order changes reached the list in, which a bare "undo" reads. One
-- number per batch: the old bot stamped a batch with one time, and the
-- carried-over accounts count as the one batch they were.
with batch as (
  select d.plan_id, d.did,
         dense_rank() over (
           order by case when p.note = 'carried over from the old list when it moved to the bot account'
                         and p.totals is null then p.created_at else d.acted_at end,
                    d.plan_id
         ) as seq
  from decision d join plan p on p.id = d.plan_id
  where d.action is not null and d.acted_at is not null
)
update decision d set acted_seq = b.seq
from batch b where d.plan_id = b.plan_id and d.did = b.did;

insert into protected (did, reason, source, added_at)
select did, coalesce(reason, 'you follow them'), source, pg_temp.iso(coalesce(added_at, now()))
from mod.protected;

-- The newest four finished re-scores of this list: the baseline the next one
-- compares with, and what the list's bands are read from until then.
with kept as (
  select * from mod.audit
  where list_uri = current_setting('migrate.list_uri') and finished_at is not null
  order by started_at desc limit 4
)
insert into audit (id, list_uri, started_at, finished_at, total, scored)
select id::text, list_uri, pg_temp.iso(started_at), pg_temp.iso(finished_at), total, coalesce(scored, 0)
from kept;

insert into audit_item (audit_id, did, handle, band, trust, vouches, followers, protected_reason)
select i.audit_id::text, i.did, i.handle, coalesce(i.band, 'UNSCORED'), i.trust, i.vouches, i.followers,
       i.protected_reason
from mod.audit_item i
where i.audit_id::text in (select id from audit);

-- The newest brief, timed by when it was sent, so the next re-score is due a
-- week after the last one.
insert into brief (id, for_date, body, sent_at)
select id::text, pg_temp.iso(coalesce(sent_at, for_date::timestamptz)), coalesce(body, ''), pg_temp.iso(sent_at)
from mod.brief
order by for_date desc, sent_at desc nulls last
limit 1;

-- Accounts kept in the review queue. A band that is not a close one is kept
-- as NOTABLE, as bluesky-mod's own keep does.
insert into review_keep (did, band, kept_at, kept_by)
select did,
       case when band in ('PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE') then band else 'NOTABLE' end,
       pg_temp.iso(coalesce(decided_at, now())), null
from mod.review
where decision = 'keep';

-- Token counts. The id is an identity column, so the new rows take their own.
insert into llm_usage (at, kind, model, input_tokens, output_tokens)
select pg_temp.iso(at), kind, model, input_tokens, output_tokens
from mod.llm_usage
order by at;

insert into post_alert (uri, last_count, last_seen_at, alerted_at)
select uri, last_count, pg_temp.iso(last_seen_at), pg_temp.iso(alerted_at)
from mod.post_alert;

-- Watches come across stopped: bluesky-mod keeps a watch's starting set in
-- a plan of its own, which these do not have.
insert into watch (id, convo_id, uri, plan_id, mode, created_at, until, stopped_at,
                   last_checked_at, last_digest_at, stats)
select id::text, convo_id, uri, plan_id::text,
       case when mode in ('ask', 'auto') then mode else 'ask' end,
       pg_temp.iso(created_at), pg_temp.iso(until), pg_temp.iso(coalesce(stopped_at, least(until, now()))),
       pg_temp.iso(last_checked_at), pg_temp.iso(last_digest_at), coalesce(stats, '{}'::jsonb)
from mod.watch;

-- Where the old bot stopped reading DMs, so the new one answers what came in
-- while neither ran and nothing before.
insert into dm_cursor (id, cursor, updated_at)
select 1, cursor, pg_temp.iso(coalesce(updated_at, now()))
from mod.dm_cursor
order by updated_at desc nulls last
limit 1;

-- What came across, beside what was there.
select 'plans' as what, (select count(*) from mod.plan) as before,
       (select count(*) from plan where note is distinct from 'carried over from the old list when it moved to the bot account') as after
union all select 'decisions', (select count(*) from mod.decision),
                 (select count(*) from decision d join plan p on p.id = d.plan_id
                  where p.note is distinct from 'carried over from the old list when it moved to the bot account')
union all select 'carried over', (select count(*) from mod.migration_item where carried_at is not null and error is null),
                 (select count(*) from decision d join plan p on p.id = d.plan_id
                  where p.note = 'carried over from the old list when it moved to the bot account')
union all select 'protected', (select count(*) from mod.protected), (select count(*) from protected)
union all select 'audits (this list, newest 4)', (select least(4, count(*)) from mod.audit
                  where list_uri = current_setting('migrate.list_uri') and finished_at is not null), (select count(*) from audit)
union all select 'review keeps', (select count(*) from mod.review where decision = 'keep'), (select count(*) from review_keep)
union all select 'token counts', (select count(*) from mod.llm_usage), (select count(*) from llm_usage)
union all select 'alerts', (select count(*) from mod.post_alert), (select count(*) from post_alert)
union all select 'watches', (select count(*) from mod.watch), (select count(*) from watch)
union all select 'dm cursor', (select count(*) from mod.dm_cursor), (select count(*) from dm_cursor);

commit;
