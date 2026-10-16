#!/usr/bin/env bash
# Applies this app's pending migrations to the shared Supabase database.
# History lives in <app>._migrations, isolated from other apps' migrations.
# Never use `supabase db push` against the shared project.
set -euo pipefail

cd "$(dirname "$0")/.."

APP="continuum"

# Read SUPABASE_DB_URL from the environment, .env.local or .env (in that
# order; `vercel env pull` rewrites .env.local, so it may live in .env).
# The files are parsed, not sourced, so values containing quotes or `$`
# don't break it.
for env_file in .env.local .env; do
  if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f "$env_file" ]; then
    SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$env_file" | tail -n 1 | cut -d= -f2- || true)"
  fi
done
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"

PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -c "set client_min_messages to warning;
  create schema if not exists ${APP};
  create table if not exists ${APP}._migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );"

for file in supabase/migrations/*.sql; do
  version="$(basename "$file" .sql)"
  applied="$("${PSQL[@]}" -tAc "select 1 from ${APP}._migrations where version = '${version}'")"
  if [ -n "$applied" ]; then continue; fi

  echo "→ applying ${version}"
  # The file and its history row commit together, or not at all. `set local`
  # makes unqualified names land in the app schema, never in public.
  "${PSQL[@]}" --single-transaction \
    -c "set local search_path to ${APP}, extensions" \
    -f "$file" \
    -c "insert into ${APP}._migrations (version) values ('${version}')"
done

echo "✓ ${APP} is up to date"
