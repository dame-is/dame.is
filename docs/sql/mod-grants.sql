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
