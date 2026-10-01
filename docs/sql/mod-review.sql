-- mod.review: the moderation queue's decisions, one row per account.
--
-- Applied 2026-10-01 as the migration `mod_review_decisions`. Decisions used to
-- live on audit_item rows, which belong to one weekly re-score, so every run
-- put back every account already decided on. See "The queue" in
-- docs/MODERATION.md and api/_lib/queue.js.
--
-- `decision` is the latest one for the account. A keep holds until the
-- account's band is more severe than `band` was; a remove holds until a
-- re-score newer than `decided_at`. `reason` is why it was in the queue
-- (PROTECTED, CONNECTED, PERIPHERAL, NOTABLE, disputed, account, ...).

create table if not exists mod.review (
  did text primary key,
  decision text not null check (decision in ('keep', 'remove')),
  reason text not null,
  band text,
  decided_at timestamptz not null default now(),
  note text
);

-- Same posture as every other mod table: RLS on, no policies, only
-- service_role. The default privileges in mod-grants.sql already cover a new
-- table; these lines say so explicitly rather than relying on it.
alter table mod.review enable row level security;
revoke all on mod.review from anon, authenticated;
grant all on mod.review to service_role;
