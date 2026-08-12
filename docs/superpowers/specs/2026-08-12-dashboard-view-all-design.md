# Dashboard "View All" screens — Design

Date: 2026-08-12
Status: Approved (revised same day — see Revision note)

## Revision note

This spec originally scoped fixing `/alerts` and `/alerts/$alertId` (they
queried a nonexistent `alerts` table) as part of this work. While that fix
was in progress here, a **separate, independently-authored PR
(`fix/alerts-tab-real-schema`, #10) fixed the same bug and merged to
`main` first** — same diagnosis, different implementation (uses
`vendors(company_name)` nested-select embeds and a new shared
`src/lib/alert-labels.ts`, day-grouped list, resolution panel already
replaced with a static "not available yet" note). This revision drops the
now-redundant sections and re-scopes the remaining work — the two new list
screens and wiring the dashboard buttons — to build on top of that merged
fix instead of duplicating it.

## Context

The dashboard (`src/routes/_authenticated/dashboard.tsx`) has three panels
with a non-functional "View All" / "View All Tasks" button:
"Upcoming Reviews & Expiries", "Recent Material Changes", and "Actions
Requiring Attention". Each panel shows only a capped preview (top 5) of its
data with no way to see the rest.

`/alerts` and `/alerts/$alertId` (the natural target for "Actions Requiring
Attention → View All") are already fixed on `main` (PR #10) to query the
real `vendor_monitoring_alerts` table. `src/lib/alert-labels.ts` now holds
the shared `alertAttributeLabel` / `describeAlertReason` helpers used by
both the Alerts pages and the dashboard.

## Goal

Make all three dashboard "View All" actions navigate to a real screen
showing the complete underlying data.

## Non-goals

- Alert resolution — already left as a static "not available yet" note by
  the merged `/alerts/$alertId` fix; not touched here.
- Search, filtering, or pagination on the two new list screens
  (`/changes`, `/expiries`) — plain complete lists, matching what the
  dashboard panels already show, just uncapped.
- Adding the new routes to the sidebar nav. They're drill-down screens
  reachable from the dashboard only, same pattern as the vendor detail page.
- Showing already-expired documents on `/expiries` — the dashboard panel's
  future-only filter was an explicit non-goal in
  [document-expiry-extraction-design.md](2026-08-11-document-expiry-extraction-design.md);
  not being expanded here.
- Changing what counts as a "material" change on the dashboard panel itself
  (still critical/attention only there). The new `/changes` screen shows
  all severities including informational, per this task's scope — the two
  are allowed to differ since one is a curated preview and the other is a
  complete record.

## Design

### 1. Share `displayValue` via `src/lib/alert-labels.ts`

`displayValue` (renders a jsonb change value — string/array/object — as
plain text) is currently private to `dashboard.tsx`. The new `/changes`
screen needs it too. Move it into `src/lib/alert-labels.ts`, alongside
`alertAttributeLabel`/`describeAlertReason` — the file's own header already
scopes it to "shared display helpers for ... `vendor_change_events`".
`dashboard.tsx` imports it from there instead of defining it locally.

### 2. New route: `/changes` — all material changes

New file `src/routes/_authenticated/changes.tsx`. Query
`vendor_change_events` joined to `vendors(company_name)` (nested-select
embed, matching the pattern the merged `/alerts` fix established), all
severities, ordered `detected_at desc`, no limit. Same row shape as the
dashboard's "Recent Material Changes" panel (icon by severity, vendor name
linked to `/vendors/$vendorId`, attribute + previous → new value, relative
time).

### 3. New route: `/expiries` — all upcoming expiries

New file `src/routes/_authenticated/expiries.tsx`. Query `vendor_documents`
joined to `vendors(company_name)`, `expiry_date >= today`, ordered
`expiry_date asc`, no limit (implemented as a separate `.in("id", vendorIds)`
query against `vendors` rather than a nested-embed select, per the plan).
Same row shape as the dashboard's
"Upcoming Reviews & Expiries" panel (vendor name linked to
`/vendors/$vendorId`, item label, expiry date), reusing
`buildUpcomingExpiries` from `src/lib/dashboard-data.ts` (unchanged).

### 4. Wire up the dashboard buttons

- "Upcoming Reviews & Expiries" → `View All` → `<Link to="/expiries">`
- "Recent Material Changes" → `View All` → `<Link to="/changes">`
- "Actions Requiring Attention" → `View All Tasks` → `<Link to="/alerts">`
  (already exists and already works, post-#10)

`Panel`'s `action` prop changes from a plain string to `{ label: string; to: ... }`,
rendering a `Link` instead of an inert `<button>`.
