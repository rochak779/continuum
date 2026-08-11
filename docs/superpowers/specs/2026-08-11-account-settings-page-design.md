# Account Settings Page — Design

Date: 2026-08-11
Status: Approved

## Context

Signup captures a user's personal details (name, phone, designation) and
organisation details (name, country, industry, company size) and writes
them into `public.profiles`, one row per user (`id = auth.uid()`). There is
currently no way for a user to view or amend that information after
signup. The sidebar already has a "Settings" nav item, but it's a dead
button.

A separate, larger request — letting an account owner add/amend team
members who can view the shared dashboard — is explicitly **out of scope**
for this spec. The current data model scopes every table
(`vendors`, `alerts`, `profiles`, etc.) by `owner_id = auth.uid()`, i.e.
single-owner per user; there is no organisation/membership model granting
shared access. An earlier attempt at that (`organisations` +
`organisation_members` with cross-table RLS) was built and then archived
(`supabase/migrations_archived/20260810140000_tenant_isolation_rls.sql`)
after hitting RLS infinite-recursion issues. That's a project of its own
and will be scoped separately.

## Goal

Let a logged-in user view and edit the profile information captured at
signup, from a real `/settings` page reachable from the sidebar.

## Non-goals

- Team member invite/access management (separate project).
- Changing login email (Supabase email-change requires a re-verification
  flow; left for a future task). Email is shown read-only.
- Changing password.
- `primary_currency` / `time_zone` columns exist on `profiles` but were
  never wired into the signup flow — they're not part of "information
  used while creating account" and are left out of this page's scope.

## Design

### Route & navigation

- New route: `src/routes/_authenticated/settings.tsx`, following the same
  `createFileRoute` pattern as `dashboard.tsx` (guarded by the
  `_authenticated` layout, which already redirects unauthenticated users
  to `/auth`).
- In `src/components/app/AppShell.tsx`, move the `Settings` entry out of
  `staticItems` (currently unclickable) and into `navItems` pointing at
  `/settings`, so it gets a real link and active-state highlighting like
  Dashboard/Vendors/Alerts.

### Data access

No schema or RLS changes — reuses `public.profiles` and the existing
"Users can view/update their own profile" policies (`auth.uid() = id`).

- **Load:** `supabase.auth.getUser()` for the read-only email, plus a
  `profiles` select for `full_name`, `organization_name`, `country`,
  `industry`, `company_size`, `phone`, `designation`.
- **Save:** `supabase.from("profiles").update({...}).eq("id", user.id)`
  with the edited fields.

### Form

One page, two visually grouped sections mirroring the signup wizard:

- **Your details** — full name, phone (dial code + number), designation
- **Your organisation** — organisation name, country, industry, company
  size

Email is displayed read-only with a short note that changing it isn't
supported here yet.

Validation reuses `organizationSchema` and a variant of `detailsSchema`
(same rules, minus `email`/`password`) from
`src/components/signup/wizard.ts`, so validation stays identical to
signup instead of drifting into a second copy of the rules. The phone
field is stored as a combined `"<dialCode> <number>"` string in
`profiles.phone`, same as signup does — on load it needs to be split back
into dial code + number for the two form fields.

### Error handling / UX

- Loading skeleton while the profile fetches.
- Inline per-field validation errors on save (zod).
- Save button disabled while the request is in flight.
- Success: inline confirmation / toast. Failure (network or RLS
  rejection): inline error message, form stays editable with entered
  values intact.
- No draft persistence — form state is local and the form is small
  enough that losing an in-progress edit on navigation-away is an
  acceptable risk.

### Testing

Consistent with this codebase's existing pattern (logic-only
`*.test.ts`; no React component tests exist anywhere in the repo today):

- Extract the phone split/join helper (`"<dialCode> <number>"` ⇄
  `{ dialCode, phone }`) into a small pure function and unit test it,
  since it's the one piece of non-trivial logic in this feature.
- The route/form component itself is not covered by automated tests,
  matching how `dashboard.tsx` and other route components are handled.

## Open questions / follow-ups (not part of this spec)

- Team member invite acceptance + shared dashboard access (needs a
  proper organisation/membership model + RLS rework).
- Email change flow.
- Whether `primary_currency` / `time_zone` should be surfaced somewhere.
