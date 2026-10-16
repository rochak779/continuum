-- Continuum's own schema in the shared "Rochak's Hobby" Supabase project.
-- See docs/shared-supabase-db.md. Applied by scripts/db-migrate.sh.
create schema if not exists continuum;
comment on schema continuum is 'Continuum (vendor risk monitoring) — github.com/rochak779/continuum';

grant usage on schema continuum to anon, authenticated, service_role;

-- Unlike the template in docs/shared-supabase-db.md section 6, there are no
-- blanket "grant all on all tables" or default privileges here. Continuum's
-- migrations grant each table and function exactly what it needs (alerts
-- are resolved only through verify_vendor_monitoring_alert, audit_events is
-- append-only, the scheduler lease functions are service-role only), and
-- blanket grants would quietly undo that.

-- The runner's history table is internal; keep it off the Data API.
revoke all on continuum._migrations from anon, authenticated;
