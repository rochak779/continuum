# Shared Supabase Database — Migration Plan & Conventions

**Audience:** any AI agent or developer working on one of Rochak's hobby projects.
**Shared project:** `Rochak's Hobby` (Supabase)
**Status:** this document is the contract. Paste it (or link it) into each repo's `AGENTS.md` / `CLAUDE.md`.

---

## 1. Why this exists

Supabase's free tier allows only two active projects. All hobby apps therefore share **one Supabase project and one Postgres database**. For that to work safely, every app must stay inside its own lane.

**The core rule:** each app owns exactly **one Postgres schema**, named after the app (for example `umeed`). An app creates, alters and drops objects only inside its own schema. It must never touch `public`, other apps' schemas, or any Supabase-managed schema. The only exceptions are the specific, prefixed items listed in section 3.

A schema is a namespace, like a folder, inside the database. Two apps can each have a `profiles` table, `umeed.profiles` and `recipes.profiles`, and they never collide.

---

## 2. What is shared and what is isolated

| Thing | Isolated per app? | Consequence |
|---|---|---|
| Tables, views, functions, types, sequences | ✅ Yes, via the app's schema | Nothing to coordinate |
| Row-Level Security policies on app tables | ✅ Yes | Each app writes its own |
| **Auth users (`auth.users`)** | ❌ Shared | One user pool for all apps. The same email and password logs in everywhere. |
| **Auth settings** (email templates, Site URL, redirect URLs, providers, SMTP) | ❌ Shared | Changing a setting changes it for every app |
| **Migration history** (Supabase CLI's `supabase_migrations` table) | ❌ Shared | **`supabase db push` breaks for every app after the first one.** See section 5. |
| Edge Functions and their secrets | ❌ Shared namespace | Prefix names |
| Storage buckets and `storage.objects` policies | ❌ Shared namespace | Prefix bucket names and scope policies by bucket |
| Cron jobs (`pg_cron`), Vault secrets | ❌ Shared namespace | Prefix names |
| Extensions (`pg_cron`, `pg_net`, `pgcrypto` …) | ❌ Database-wide | `create extension if not exists` only. Never drop one. |
| Realtime publication | ❌ Shared | Add only your own schema-qualified tables |
| API keys (anon and service role) | ❌ Shared | A leaked service role key exposes **every** app. Keep it server-side only. |
| Free-tier quotas (500 MB DB, bandwidth, function calls) | ❌ Shared | Keep seed data small. Don't store large blobs in tables. |

---

## 3. Rules

### MUST
1. Put every database object in your app schema `<app>`. Schema-qualify names in new SQL (`create table <app>.orders …`).
2. Enable Row-Level Security on every table in your schema, and write explicit policies.
3. Pin `search_path` on every function: `set search_path = <app>, extensions, pg_temp`.
4. Grant Data API access to your schema explicitly (see the template in section 6).
5. Prefix every shared-namespace item with the app name:

   | Item | Convention | Example |
   |---|---|---|
   | Schema | `<app>` (lowercase, `a-z0-9_`) | `umeed` |
   | Edge Function | `<app>-<name>` | `umeed-poll-due-work` |
   | Edge Function secret / env var | `<APP>_<NAME>` | `UMEED_CRON_SECRET` |
   | Cron job | `<app>-<name>` | `umeed-poll-due-work` |
   | Vault secret | `<app>_<name>` | `umeed_cron_secret` |
   | Storage bucket | `<app>-<name>` | `umeed-avatars` |
   | Storage policy | `"<app>: <description>"`, **scoped by `bucket_id`** | `"umeed: members read avatars"` |
   | `auth.users` metadata keys | nested under the app name | `raw_user_meta_data -> 'umeed'` |

6. Treat a user as belonging to your app only if they have a row in `<app>.profiles` (or your equivalent table). Create that row from app code on first sign-in or onboarding.
7. Before claiming a schema name, check that it is free:
   `select nspname from pg_namespace order by 1;`
   Then add a comment to your schema: `comment on schema <app> is '<App name> — <repo url>';`
8. Apply migrations **only** with the per-app runner in section 5.

### MUST NEVER
1. ❌ Run `supabase db push`, `supabase db reset --linked`, or `supabase db pull` against the shared project. **`db reset --linked` wipes every app's data.**
2. ❌ Create, alter or drop anything in `public`, `auth`, `storage` (except prefixed buckets and bucket-scoped policies), `extensions`, `cron`, `vault`, `realtime` or `supabase_*`, or in another app's schema.
3. ❌ Add triggers or functions on `auth.users`. They fire for every app's sign-ups.
4. ❌ Use `drop … cascade` on anything outside your own schema.
5. ❌ Read or write another app's schema, even if it seems convenient.
6. ❌ Change shared auth settings (email templates, Site URL, providers) without asking Rochak. Adding **your own** redirect URL to the allow-list is fine.
7. ❌ Remove another app's schema from the "Exposed schemas" list.
8. ❌ Commit `SUPABASE_DB_URL`, the service role key or the DB password.

---

## 4. Repo structure every app follows

```
<repo>/
├── .env.local                     # gitignored — see env vars below
├── scripts/
│   └── db-migrate.sh              # the per-app migration runner (section 5)
└── supabase/
    ├── config.toml                # local CLI config only
    ├── migrations/
    │   ├── 00000000000000_<app>_schema.sql   # creates schema + grants (section 6)
    │   └── YYYYMMDDHHMMSS_<description>.sql  # every change after that
    └── functions/
        └── <app>-<name>/          # folder name = deployed function name
            └── index.ts
```

**Environment variables** (`.env.local`, never committed):

```
SUPABASE_URL=https://<ref>.supabase.co          # shared project
SUPABASE_ANON_KEY=...                           # shared project
SUPABASE_SERVICE_ROLE_KEY=...                   # shared project, server-side only
SUPABASE_DB_URL=postgresql://postgres.<ref>:<url-encoded-password>@aws-1-eu-west-1.pooler.supabase.com:5432/postgres
```

Use the **session pooler** connection string (port 5432) for `SUPABASE_DB_URL`. Copy it from Dashboard → Connect rather than typing it. The host is `aws-1-…`, not `aws-0-…`. URL-encode any special characters in the password (`python3 -c 'import urllib.parse;print(urllib.parse.quote(input(),safe=""))'`).

Prefix client-side variables as your framework requires (for example `VITE_`). Never expose the service role key to the browser.

---

## 5. The migration runner

The Supabase CLI stores migration history in a single table for the whole database. Once one app has pushed, `supabase db push` from any other app fails with "Remote migration versions not found in local migrations directory". Each app therefore tracks its own history in `<app>._migrations` and applies its files with `psql`.

You can still use `supabase migration new <name>` to create timestamped files. Just don't `push`.

`scripts/db-migrate.sh`:

This script was proven on Umeed's migration. Copy it and change only `APP`:

```bash
#!/usr/bin/env bash
# Applies this app's pending migrations to the shared Supabase database.
# History lives in <app>._migrations, isolated from other apps' migrations.
# Never use `supabase db push` against the shared project.
set -euo pipefail

cd "$(dirname "$0")/.."

APP="<app>"

# Read SUPABASE_DB_URL from the environment or .env.local. .env.local is
# parsed, not sourced, so values containing quotes or `$` don't break it.
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f .env.local ]; then
  SUPABASE_DB_URL="$(grep -E '^SUPABASE_DB_URL=' .env.local | tail -n 1 | cut -d= -f2-)"
fi
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
```

Don't set the search path through `PGOPTIONS`: the Supabase pooler may not pass it through. The `set local` above is reliable.

Make it executable with `chmod +x scripts/db-migrate.sh`, and add `"db:migrate": "scripts/db-migrate.sh"` to `package.json`. The script needs `psql`; on macOS, install it with `brew install libpq`.

Each migration runs in a single transaction. The rare statements that can't run in a transaction, such as `create index concurrently`, must go in a hand-run step.

**Typed client generation** still works with the CLI:

```bash
supabase gen types typescript --project-id <ref> --schema <app> > src/<path>/database.types.ts
```

**Edge Functions** deploy one at a time and don't affect other apps:

```bash
supabase functions deploy <app>-<name> --project-ref <ref> --use-api   # --use-api: no Docker needed
supabase secrets set <APP>_<NAME>=... --project-ref <ref>
```

Never run `supabase link` against the shared project. Pass `--project-ref` on each command instead, so that a stray `--linked` flag has nothing to hit.

**Vault secrets** go in through `psql`, never through a migration file:

```bash
printf "select vault.create_secret('%s', '<app>_<name>', '<description>');\n" "$SECRET" | psql "$SUPABASE_DB_URL" -X -q -o /dev/null
```

**Cron jobs** are enabled and paused with `cron.alter_job`. The pooler role can't `update cron.job` directly:

```sql
select cron.alter_job(jobid, active := false) from cron.job where jobname = '<app>-<name>';
```

---

## 6. Schema bootstrap template

This is the first migration in every app. Replace `<app>` throughout.

```sql
-- 00000000000000_<app>_schema.sql
create schema if not exists <app>;
comment on schema <app> is '<App name> — <repo url>';

grant usage on schema <app> to anon, authenticated, service_role;

grant all on all tables    in schema <app> to anon, authenticated, service_role;
grant all on all routines  in schema <app> to anon, authenticated, service_role;
grant all on all sequences in schema <app> to anon, authenticated, service_role;

alter default privileges for role postgres in schema <app>
  grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema <app>
  grant all on routines  to anon, authenticated, service_role;
alter default privileges for role postgres in schema <app>
  grant all on sequences to anon, authenticated, service_role;

-- Extensions are database-wide: create if missing, never drop.
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net with schema extensions;
```

These grants are safe because RLS, not grants, decides who sees which rows. That's why every table must have RLS enabled.

Then, **once per app**, in the Dashboard: go to **Project Settings → Data API → Exposed schemas** and **add** `<app>`. Leave every existing entry in place.

**Client setup:**

```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "<app>" }, // every .from() and .rpc() now targets the app schema
});
```

**TypeScript:** without a generated `Database` type, a client built with `db: { schema: "<app>" }` is typed `SupabaseClient<any, "<app>">`. That type won't assign to a plain `SupabaseClient`. Cast once where the client is built (`as unknown as SupabaseClient`) instead of changing every repository's signature. With generated types, use `SupabaseClient<Database, "<app>">` instead.

**Realtime** subscriptions must name the schema: `{ event: "*", schema: "<app>", table: "orders" }`.

---

## 7. Migrating an existing app into the shared project

Work through these steps in order. Check each box before moving on.

### Step 0 — Decide on data
- [ ] **No data worth keeping** (the common case for hobby apps): rebuild the schema from migrations in the shared project. Follow steps 1–7.
- [ ] **Data worth keeping:** follow steps 1–7, then do step 8 to copy the data across from the old project. Don't delete the old project until step 8 is verified.

- [ ] **Already in the shared project, but in `public`** (for example, the learning app): **don't** rebuild or dump anything. Move the objects in place, which keeps every row and user. Follow the "In-place move" box below instead of steps 3 and 6.

> **In-place move (app already lives in `public` of the shared project)**
> 1. Write one new migration, applied with this app's new runner:
>    ```sql
>    create schema if not exists <app>;
>    -- …plus the grants from section 6…
>    alter table public.<table> set schema <app>;          -- one line per table; indexes, constraints, RLS policies and triggers move with it
>    alter function public.<fn>(<arg types>) set schema <app>;   -- one line per function
>    alter function <app>.<fn>(<arg types>) set search_path = <app>, extensions, pg_temp;
>    ```
>    Grants and RLS policies carry over. Function *bodies* aren't rewritten, so fix any body that says `public.<table>` by hand.
> 2. Since the old migration files already ran from `public`, **don't** edit or re-run them. Seed the new runner's history so it skips them: `insert into <app>._migrations (version) select version from supabase_migrations.schema_migrations where name in (…this app's migrations…);`
> 3. Ship the code change (`db: { schema: "<app>" }`) and add `<app>` to Exposed schemas **at the same time** as the migration. In between, the live app will get errors. For a hobby app, a few minutes of downtime is fine.
> 4. Run step 7's checks. Afterwards, `public` should be empty of this app's tables.

### Step 1 — Pick and claim the schema name
- [ ] Choose `<app>`: short, lowercase, `a-z0-9_`.
- [ ] Confirm it isn't taken (`select nspname from pg_namespace;`).

### Step 2 — Environment
- [ ] Point `SUPABASE_URL`, the anon key and the service role key at `Rochak's Hobby`.
- [ ] Add `SUPABASE_DB_URL` to `.env.local` and `.env.example` (empty in the example).
- [ ] Run `supabase unlink` if the repo is linked to its old project.

### Step 3 — Make the migrations schema-aware
The shared database has never run this app's migrations, so the existing files may be edited in place.
- [ ] Add the bootstrap migration from section 6 as the **earliest** file.
- [ ] Search every migration for `public.` and replace it with `<app>.` (or with nothing, since the runner's search path defaults to `<app>`).
- [ ] Search for `search_path = public` and change it to `search_path = <app>, extensions, pg_temp`.
- [ ] Make sure every `create function` pins `search_path`. Trigger functions and functions called by cron don't get the API's search path.
- [ ] Remove any trigger or function on `auth.users`. Move that logic into app code (for example, "create the profile row on first sign-in").
- [ ] Rename cron jobs, Vault secrets, storage buckets and Edge Function URLs referenced in SQL to their prefixed names (section 3).
- [ ] Make storage policies check `bucket_id = '<app>-…'`.
- [ ] Remove any `drop extension` and any `create extension` without `if not exists`.

### Step 4 — Runner and repo structure
- [ ] Add `scripts/db-migrate.sh` (section 5) and the `db:migrate` npm script.
- [ ] Rename `supabase/functions/<name>/` to `supabase/functions/<app>-<name>/`, and update every caller, including cron SQL and client `functions.invoke(...)` calls.
- [ ] Prefix Edge Function secrets and update the code that reads them.
- [ ] Remove any scripts or CI steps that call `supabase db push` or `supabase db reset --linked`.

### Step 5 — Application code
- [ ] Add `db: { schema: "<app>" }` to **every** `createClient` call, including server-side and service-role clients.
- [ ] Update any raw SQL or `postgres`/`pg` connections to schema-qualify names or set `search_path`.
- [ ] Namespace `user_metadata` reads and writes under `<app>`.
- [ ] Handle a signed-in user who has no `<app>.profiles` row as a new user (onboarding), not as an error.
- [ ] Regenerate types with `--schema <app>`.

### Step 6 — Apply
- [ ] Dashboard: add `<app>` to **Exposed schemas**.
- [ ] Run `npm run db:migrate` (or `bun run db:migrate`).
- [ ] Deploy Edge Functions under their prefixed names, and set their prefixed secrets.
- [ ] Create any Vault secrets by hand (never in migrations).
- [ ] Add the app's URLs to Auth → URL Configuration → **Redirect URLs**.

### Step 7 — Verify
- [ ] `select tablename from pg_tables where schemaname = 'public';` shows **nothing from this app**.
- [ ] `select tablename, rowsecurity from pg_tables where schemaname = '<app>';` shows RLS enabled on every table except `_migrations`.
- [ ] `select jobname from cron.job;` shows only prefixed jobs for this app.
- [ ] Running `db:migrate` a second time prints only "up to date".
- [ ] The app's test suite passes against the shared project.
- [ ] Sign-up, sign-in and one core read/write flow work end to end.
- [ ] Another app in the shared project still works (smoke test).

### Step 8 — Only if you're keeping data
- [ ] Dump the data only from the old project: `pg_dump "$OLD_DB_URL" --data-only --schema=public --table='<tables>' > data.sql`.
- [ ] Replace `public.` with `<app>.` in `data.sql`, then restore it with `psql "$SUPABASE_DB_URL" -f data.sql`.
- [ ] Users live in `auth.users`, which a data-only dump of `public` does not move. Either ask users to sign up again, or migrate them with Supabase's auth export/import. Ask Rochak before doing the import.
- [ ] Pause the old project only after the Step 7 checks pass on the migrated data.

---

## 8. Starting a brand-new app

1. Claim a schema name (section 3, rule 7).
2. Copy `scripts/db-migrate.sh` and the bootstrap migration (section 6).
3. Set up `.env.local` (section 4) and the client with `db: { schema: "<app>" }`.
4. Add `<app>` to Exposed schemas and run `db:migrate`.
5. Add a row for the app to the registry below.

---

## 9. App registry

Update this table in each repo's copy when you add an app. Also comment on the schema itself (section 3, rule 7); that comment in the live database is the source of truth.

| Schema | App | Repo | Edge Functions | Cron jobs | Buckets |
|---|---|---|---|---|---|
| `umeed` | Umeed (family elder-care) | github.com/rochak779/Umeed | `umeed-poll-due-work` | `umeed-poll-due-work` (paused) | — |
| `marg` | Marg (AI learning app). Moved out of `public` in place, 2026-09-24. | github.com/rochak779/Marg | — | — | — |
| `continuum` | Continuum (vendor risk monitoring). Rebuilt fresh from its own project, 2026-10-16. | github.com/rochak779/continuum-new | — | `continuum-companies-house-monitoring` | `continuum-vendor-documents` |

No app may add to `public`.
