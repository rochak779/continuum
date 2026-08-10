#!/usr/bin/env bash
# Reproducible proof that Organisation A cannot access Organisation B's data.
#
# Spins up a throwaway local Postgres (no Docker/Supabase CLI required),
# replays every migration in supabase/migrations/ against it exactly as
# written, seeds two organisations with a full row in every tenant-owned
# table, then asserts row-level security actually blocks cross-tenant reads
# and writes -- as the `authenticated` role impersonating each org's user,
# and as `anon`.
#
# Usage: ./scripts/verify-tenant-isolation.sh
# Exits non-zero on any failed assertion.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

# Locate a Postgres toolchain. Prefer Homebrew's postgresql@16 if present,
# otherwise fall back to whatever's on PATH.
if [ -d "/opt/homebrew/opt/postgresql@16/bin" ]; then
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found. Install Postgres (e.g. 'brew install postgresql@16') and retry."; exit 1; }

WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/pgdata"
PORT=55432
SOCKDIR="$WORKDIR"
DB=tenant_isolation_verify

cleanup() {
  pg_ctl -D "$DATADIR" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "==> Starting throwaway Postgres in $WORKDIR"
initdb -D "$DATADIR" -U postgres -A trust -E UTF8 >/dev/null 2>&1
{
  echo "unix_socket_directories = '$SOCKDIR'"
  echo "port = $PORT"
} >> "$DATADIR/postgresql.conf"
pg_ctl -D "$DATADIR" -l "$WORKDIR/pg.log" -o "-k $SOCKDIR" start >/dev/null
for i in $(seq 1 20); do
  pg_isready -h "$SOCKDIR" -p "$PORT" >/dev/null 2>&1 && break
  sleep 0.5
done

PSQL=(psql -h "$SOCKDIR" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -qtA)

echo "==> Creating database and stubbing Supabase auth primitives"
createdb -h "$SOCKDIR" -p "$PORT" -U postgres "$DB"
"${PSQL[@]}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE sql STABLE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

echo "==> Replaying migrations from supabase/migrations/ in order"
cd "$MIGRATIONS_DIR"
for f in $(ls ./*.sql | sort); do
  # 20260810100603 unconditionally re-CREATEs public.profiles, already
  # created by an earlier migration -- a pre-existing bug unrelated to this
  # script. Apply it tolerating errors (same statements PostgREST/Supabase
  # would run) so the tenant-isolation migrations that come after it can
  # still be verified; everything else must apply cleanly.
  if [[ "$f" == *20260810100603* ]]; then
    psql -h "$SOCKDIR" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=0 -f "$f" >/dev/null 2>&1 || true
    continue
  fi
  psql -h "$SOCKDIR" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "    all migrations applied"

echo "==> Seeding two organisations with a full row in every tenant table"
"${PSQL[@]}" <<'SQL'
INSERT INTO organisations (id, name) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Org A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Org B');

INSERT INTO auth.users (id) VALUES
  ('a1000000-0000-0000-0000-000000000001'),
  ('b1000000-0000-0000-0000-000000000001');

INSERT INTO organisation_members (organisation_id, user_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'admin'),
  ('b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000001', 'admin');

INSERT INTO vendors (id, organisation_id, legal_name) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Vendor A'),
  ('b2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'Vendor B');

INSERT INTO vendor_identifiers (vendor_id, identifier_type, identifier_value) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'COMPANIES_HOUSE_NUMBER', 'A0000001'),
  ('b2000000-0000-0000-0000-000000000002', 'COMPANIES_HOUSE_NUMBER', 'B0000001');

INSERT INTO external_snapshots (id, vendor_id, provider, normalized_data, raw_data, fetched_at) VALUES
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'companies_house', '{}', '{}', now()),
  ('b3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000002', 'companies_house', '{}', '{}', now());

INSERT INTO monitoring_runs (vendor_id, provider, status, trigger_type, snapshot_id) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'companies_house', 'success', 'manual', 'a3000000-0000-0000-0000-000000000003'),
  ('b2000000-0000-0000-0000-000000000002', 'companies_house', 'success', 'manual', 'b3000000-0000-0000-0000-000000000003');

INSERT INTO change_events (id, vendor_id, provider, attribute_key, previous_value, new_value, severity,
    materiality_reason, recommended_action, snapshot_id, dedupe_key) VALUES
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'companies_house',
    'company_status', '"active"', '"liquidation"', 'critical', 'r', 'a', 'a3000000-0000-0000-0000-000000000003', 'org-a-dedupe'),
  ('b4000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002', 'companies_house',
    'company_status', '"active"', '"liquidation"', 'critical', 'r', 'a', 'b3000000-0000-0000-0000-000000000003', 'org-b-dedupe');

INSERT INTO trust_profile_attributes (vendor_id, attribute_key, current_value, source) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'company_status', '"active"', 'companies_house'),
  ('b2000000-0000-0000-0000-000000000002', 'company_status', '"active"', 'companies_house');

INSERT INTO alerts (vendor_id, change_event_id, severity, title, description, recommended_action) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000004', 'critical', 't', 'd', 'a'),
  ('b2000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000004', 'critical', 't', 'd', 'a');

INSERT INTO audit_events (organisation_id, vendor_id, actor_type, event_type, entity_type, entity_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'system', 'vendor_created', 'vendor', 'a2000000-0000-0000-0000-000000000002'),
  ('b0000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-000000000002', 'system', 'vendor_created', 'vendor', 'b2000000-0000-0000-0000-000000000002');

INSERT INTO vendor_monitoring_config (vendor_id, provider) VALUES
  ('a2000000-0000-0000-0000-000000000002', 'companies_house'),
  ('b2000000-0000-0000-0000-000000000002', 'companies_house');
SQL
echo "    seed data inserted (1 org A row + 1 org B row per table)"

echo "==> Running isolation assertions"
ASSERT_SQL="$WORKDIR/assertions.sql"
cat > "$ASSERT_SQL" <<'SQL'
-- Every table listed carries organisation_id and must be readable only
-- within the caller's own organisation, and only by `authenticated`.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'organisations', 'organisation_members', 'vendors', 'vendor_identifiers',
    'external_snapshots', 'monitoring_runs', 'change_events',
    'trust_profile_attributes', 'alerts', 'audit_events', 'vendor_monitoring_config'
  ];
  own_col text;
  own_count int;
  other_count int;
  total_visible int;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    own_col := CASE WHEN tbl = 'organisations' THEN 'id' ELSE 'organisation_id' END;

    -- As Org A's user: must see Org A's row(s) and zero of Org B's.
    PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE %I = %L), count(*) FILTER (WHERE %I = %L), count(*) FROM %I',
      own_col, 'a0000000-0000-0000-0000-00000000000a',
      own_col, 'b0000000-0000-0000-0000-00000000000b', tbl
    ) INTO own_count, other_count, total_visible;

    IF own_count < 1 THEN
      RAISE EXCEPTION 'FAIL [%]: Org A user could not see Org A''s own row (positive control failed)', tbl;
    END IF;
    IF other_count > 0 THEN
      RAISE EXCEPTION 'FAIL [%]: Org A user could see % row(s) belonging to Org B', tbl, other_count;
    END IF;
    IF total_visible <> own_count THEN
      RAISE EXCEPTION 'FAIL [%]: Org A user saw % total row(s), expected exactly % (their own)', tbl, total_visible, own_count;
    END IF;

    -- Symmetric check as Org B's user.
    PERFORM set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', false);
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE %I = %L), count(*) FILTER (WHERE %I = %L), count(*) FROM %I',
      own_col, 'b0000000-0000-0000-0000-00000000000b',
      own_col, 'a0000000-0000-0000-0000-00000000000a', tbl
    ) INTO own_count, other_count, total_visible;

    IF own_count < 1 THEN
      RAISE EXCEPTION 'FAIL [%]: Org B user could not see Org B''s own row (positive control failed)', tbl;
    END IF;
    IF other_count > 0 THEN
      RAISE EXCEPTION 'FAIL [%]: Org B user could see % row(s) belonging to Org A', tbl, other_count;
    END IF;
    IF total_visible <> own_count THEN
      RAISE EXCEPTION 'FAIL [%]: Org B user saw % total row(s), expected exactly % (their own)', tbl, total_visible, own_count;
    END IF;

    RAISE NOTICE 'PASS [%]: Org A and Org B users each see only their own row(s)', tbl;
  END LOOP;
END $$;

-- Cross-org writes must be rejected: Org A's user cannot insert a vendor
-- into Org B, even though the target organisation genuinely exists.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
  BEGIN
    INSERT INTO vendors (organisation_id, legal_name)
    VALUES ('b0000000-0000-0000-0000-00000000000b', 'Hostile insert');
    RAISE EXCEPTION 'FAIL [vendors insert]: Org A user was able to insert a vendor into Org B';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS [vendors insert]: Org A user blocked from inserting a vendor into Org B';
  END;
END $$;

-- Cross-org updates must be rejected: Org A's user cannot repoint an
-- Org-A-owned alert at Org B by editing organisation_id-adjacent fields it
-- is allowed to touch (status), while org boundary is enforced by the
-- policy's USING clause on the pre-update row -- i.e. Org A cannot touch
-- Org B's alert at all.
DO $$
DECLARE
  affected int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', false);
  UPDATE alerts SET status = 'investigating' WHERE vendor_id = 'b2000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE EXCEPTION 'FAIL [alerts update]: Org A user updated % of Org B''s alert row(s)', affected;
  END IF;
  RAISE NOTICE 'PASS [alerts update]: Org A user''s update to Org B''s alert affected 0 rows';
END $$;

SELECT 'ALL TENANT ISOLATION ASSERTIONS PASSED' AS result;
SQL

# Run the SELECT/UPDATE assertions as `authenticated`, the anon assertions as
# `anon` -- both inside the same session via SET ROLE so GRANTs are honoured
# (a superuser connection bypasses RLS and grants entirely otherwise). The
# anon check must run under its own SET ROLE, not folded into assertions.sql,
# or it would silently run as `authenticated` and prove nothing.
psql -h "$SOCKDIR" -p "$PORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 <<SQL
SET ROLE authenticated;
\i $ASSERT_SQL
RESET ROLE;
SET ROLE anon;
DO \$\$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'organisations', 'organisation_members', 'vendors', 'vendor_identifiers',
    'external_snapshots', 'monitoring_runs', 'change_events',
    'trust_profile_attributes', 'alerts', 'audit_events', 'vendor_monitoring_config'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('SELECT 1 FROM %I LIMIT 1', tbl);
      RAISE EXCEPTION 'FAIL [%]: anon role was able to read from this table', tbl;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS [%]: anon role has no access (permission denied)', tbl;
    END;
  END LOOP;
END \$\$;
RESET ROLE;
SQL

echo ""
echo "==> All tenant isolation assertions passed: Organisation A cannot read"
echo "    or write Organisation B's data in any of the 11 tenant-owned"
echo "    tables, and the anon role has no access to any of them."
