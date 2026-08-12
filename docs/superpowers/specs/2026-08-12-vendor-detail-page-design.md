# Vendor Detail Page — Design

Date: 2026-08-12
Status: Approved

## Context

The vendors list (`src/routes/_authenticated/vendors/index.tsx`) shows one
row per vendor with company, category, country, owner, risk, monitoring
status, and a documents cell (`VendorDocumentsCell`, added in
[vendor-documents-design.md](2026-08-11-vendor-documents-design.md)). There
is no dedicated page for a single vendor — you can't see the full picture
(Companies House data, all core fields, documents) in one place, and rows
aren't linked to anywhere.

Companies House data already exists per vendor in `vendor_company_snapshots`
(company number, status, type, incorporation date, registered office
address, SIC codes, accounts/confirmation-statement due dates), populated by
the existing monitoring pipeline (`src/integrations/companies-house/*`).

## Goal

Give each vendor a dedicated, read-only detail page reachable from the
vendors list, showing everything Continuum knows about that vendor: its
core record, the latest Companies House data pulled for it, and its
uploaded documents.

## Non-goals

- Editing vendor fields from this page. Vendor records are read-only here;
  editing (if it exists) stays wherever it lives today.
- Monitoring alert/failure history on this page. The list view's status
  badge/tooltip already covers current health; a fuller history view is a
  separate future feature if needed.
- Any change to the documents feature itself — the detail page reuses
  `VendorDocumentsCell` unmodified.

## Design

### Route

New file route `src/routes/_authenticated/vendors/$vendorId.tsx`, following
the existing `alerts/$alertId.tsx` detail-page pattern: `AppShell` wrapper,
a back-button header, card sections in a `<dl>`/`Field` (dt/dd) layout,
loading/error/not-found states.

### Entry point

`vendors/index.tsx` gets a new trailing "Actions" column with a "View
Details" link per row, navigating to `/vendors/$vendorId` (using the
vendor's `id`). No other change to the existing table.

### Data fetching

Two queries, plus the documents cell's own internal query:

1. `vendors` row for `$vendorId` (`select("*").eq("id", vendorId).maybeSingle()`).
2. Latest `vendor_company_snapshots` row for that vendor
   (`select("*").eq("vendor_id", vendorId).order("checked_at", { ascending: false }).limit(1).maybeSingle()`).

If the vendor query returns null, show "This vendor could not be found."
(same pattern as the alert detail page). If the snapshot query returns
null, the Companies House card renders an empty state — this is expected
for vendors where monitoring hasn't run yet, not an error.

### Page layout

Three card sections, top to bottom:

**1. Vendor info**
Company name (as page title), category, country, internal owner, risk
level, email, internal vendor ID, monitoring status (raw value from
`vendors.monitoring_status`, no health computation), source, created date.

**2. Companies House data**
Company number, company status, company type, date of incorporation,
registered office address (assembled from the JSON fields —
`address_line_1`, `address_line_2`, `locality`, `region`, `postal_code`,
`country` — into a formatted multi-line address), SIC codes (comma-joined),
accounts next due, confirmation statement next due. Empty state: "No
Companies House data yet."

**3. Documents**
Renders `<VendorDocumentsCell vendorId={vendorId} />` unchanged — same
upload/download/delete behavior as the list view.

### Error handling

- Malformed/missing `vendorId` param → handled by TanStack Router's normal
  not-found flow, no special handling needed.
- Supabase query errors surface the same way as the alert detail page: an
  inline destructive-text message instead of the page content.

### Testing

No new business logic to unit-test — this page is a straight read/render
of existing tables via existing query patterns. Manual verification: open a
vendor with a Companies House snapshot and documents, and one without
either, confirming both render sensibly.
