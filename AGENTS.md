<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Database: shared Supabase project

Continuum's tables live in the `continuum` schema of the "Rochak's Hobby" Supabase project, which is shared with other apps. Read `docs/shared-supabase-db.md` before any DB work.

- Never run `supabase db push` / `db reset --linked` / `db pull`, or `supabase link` against it. Apply migrations with `npm run db:migrate` (needs `SUPABASE_DB_URL` in `.env` or `.env.local`).
- Database changes go through this repo's migrations only, not through Lovable.
- `auth.users` is shared: no triggers on it, and keep user metadata under the `continuum` key. Profiles are created on first sign-in (`src/lib/continuum-profile.ts`).
- Grant each new table only what it needs, as the existing migrations do; the schema deliberately has no blanket default grants.
