-- BEFORE THE GRANTS: the schema has to be exposed, and the dashboard toggle
-- did not take. Exposing `mod` under Settings -> API -> Exposed schemas showed
-- as saved and as "7 of 9 schemas exposed" in the UI, while the value PostgREST
-- actually reads still listed six. The symptom is a 406 with PGRST106:
--
--   Invalid schema: mod
--   Only the following schemas are exposed: public, graphql_public, ...
--
-- Check what is really configured, rather than what the dashboard claims:
--
--   select unnest(s.setconfig) from pg_db_role_setting s
--   join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
--
-- If `mod` is missing from pgrst.db_schemas, set it here. Append to the list
-- that is already there; overwriting it with a shorter one takes the other
-- apps' schemas offline. The two NOTIFYs make PostgREST reload without waiting
-- for a restart.
--
--   alter role authenticator set pgrst.db_schemas =
--     'public, graphql_public, trackerapp, credblue, typesapp, turtleme, mod';
--   notify pgrst, 'reload config';
--   notify pgrst, 'reload schema';
--
-- Exposure and grants are independent. Exposure decides which schemas
-- PostgREST will serve; the grants below decide who may read them. Both were
-- missing, and each produces a different error, so fixing one leaves the other
-- looking like a fresh problem.

-- Grants for the `mod` schema on the atpota.to project.
--
-- Kept here because this is the step that is invisible until it fails, and the
-- failure message ("permission denied for schema mod") points at the schema
-- rather than at the grant that was never made.
--
-- Supabase configures default privileges for `public`. A hand-created schema
-- inherits NONE of them, so `create schema mod` leaves service_role — the role
-- the Data API assumes for a service-key request — with no USAGE and no table
-- privileges. Exposing the schema in the dashboard does not fix that: exposure
-- controls which schemas PostgREST will serve, not who may read them.
--
-- The dashboard's per-table "Exposed tables" toggles manage the Data API roles
-- (anon, authenticated). Leave every mod table UNTICKED. service_role gets its
-- access from this file; anon and authenticated should have neither a grant nor
-- a row-level policy, which is two independent reasons they see nothing from a
-- table that records what was nearly done to a named person.

grant usage on schema mod to service_role;
grant all privileges on all tables in schema mod to service_role;
grant all privileges on all sequences in schema mod to service_role;
grant execute on all functions in schema mod to service_role;

-- So the next migration does not have to remember.
alter default privileges in schema mod grant all on tables to service_role;
alter default privileges in schema mod grant all on sequences to service_role;
alter default privileges in schema mod grant execute on functions to service_role;

-- Re-assert the exclusion after the grants, and make it the default. Without
-- the ALTER DEFAULT PRIVILEGES lines a table added by a later migration would
-- pick up whatever "automatically expose new tables" is set to.
revoke all on schema mod from anon, authenticated;
revoke all on all tables in schema mod from anon, authenticated;
revoke all on all sequences in schema mod from anon, authenticated;
revoke all on all functions in schema mod from anon, authenticated;

alter default privileges in schema mod revoke all on tables from anon, authenticated;
alter default privileges in schema mod revoke all on sequences from anon, authenticated;
alter default privileges in schema mod revoke all on functions from anon, authenticated;

-- Verify. service_role should be 6/6, the other two 0/6.
--
-- with checks as (
--   select 'schema USAGE' as scope, r.rolname as role,
--          has_schema_privilege(r.rolname,'mod','USAGE') as ok
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
--   union all select 'vouch SELECT', r.rolname,
--          has_table_privilege(r.rolname,'mod.vouch','SELECT')
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
--   union all select 'circle INSERT', r.rolname,
--          has_table_privilege(r.rolname,'mod.circle','INSERT')
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
--   union all select 'audit_item UPDATE', r.rolname,
--          has_table_privilege(r.rolname,'mod.audit_item','UPDATE')
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
--   union all select 'llm_usage seq USAGE', r.rolname,
--          has_sequence_privilege(r.rolname,'mod.llm_usage_id_seq','USAGE')
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
--   union all select 'finalise_snapshot EXEC', r.rolname,
--          has_function_privilege(r.rolname,'mod.finalise_snapshot(timestamptz)','EXECUTE')
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role')
-- )
-- select role, count(*) filter (where ok) as granted,
--        count(*) filter (where not ok) as denied
-- from checks group by role order by role;
