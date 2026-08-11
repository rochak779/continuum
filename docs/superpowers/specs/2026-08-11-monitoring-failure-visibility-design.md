# Monitoring failure visibility — design

## Problem

When a Companies House baseline/scheduled check fails for a vendor (e.g. the
company number isn't found — the common case when the app is pointed at the
Companies House **sandbox** environment and a real-world company number is
used), the vendor's `monitoring_status` is set to `"failing"`. The dashboard
correctly renders this, but `calculateVendorHealth` maps every non-`monitoring`/
`current` status to the single generic label **"Monitoring Issue"**. There is
no way to tell, from the UI, *why* a vendor is stuck there — the reason
(`vendor_monitoring_failures.error_type` / `.message`) is recorded but never
surfaced. It only appears in a server console log.

Separately, `/vendors` (the full vendor list) has no status column at all and
doesn't fetch alerts, so it can't compute vendor health today.

## Goal

Make a "Monitoring Issue" status self-explanatory in the UI, in both places a
user sees vendor status: the dashboard's vendor directory table, and the full
`/vendors` list.

## Non-goals

- No vendor detail page (doesn't exist yet; out of scope here).
- No retry-from-UI action, no failure history view — just surfacing the most
  recent reason.
- No schema/backend changes — `vendor_monitoring_failures` already has
  everything needed (`error_type`, `message`, `checked_at`), is indexed on
  `(vendor_id, checked_at DESC)`, and RLS already scopes it to the owner's
  vendors.

## Design

### 1. `latestFailureByVendor` helper (`src/lib/dashboard-data.ts`)

Pure function, same style as `buildDashboardSummary`:

```ts
interface VendorFailure {
  vendor_id: string;
  error_type: string;
  message: string | null;
  checked_at: string;
}

function latestFailureByVendor(
  failures: readonly VendorFailure[],
): Map<string, VendorFailure>
```

Reduces a list of failure rows (which may contain multiple historical
failures per vendor) down to the single most recent one per `vendor_id`.
Assumes rows may arrive in any order — compares `checked_at` rather than
relying on query order, so it's safe regardless of the caller's `.order()`.

Unit tested directly (multiple failures for one vendor → latest wins; empty
input → empty map; unrelated vendors don't collide).

### 2. `VendorStatusBadge` component (`src/components/app/VendorStatusBadge.tsx`)

```ts
function VendorStatusBadge({
  health,
  failureReason,
}: {
  health: VendorHealth;
  failureReason?: string | undefined;
}): JSX.Element
```

Renders the existing `VENDOR_HEALTH_LABELS[health]` text with the existing
dashboard styling. When `health === "monitoring_issue"` and `failureReason`
is provided, wraps the label in a native `title` tooltip attribute showing
the reason (e.g. `"Company not found"`) and adds a small inline warning icon
so the affordance is discoverable without hovering blind. No new UI
dependency — native `title` tooltip, consistent with the codebase's current
lack of a tooltip component.

`failureReason` is derived by the caller from `latestFailureByVendor`,
formatted as `error_type` humanized (e.g. `not_found` → `"Company not
found"`) falling back to the raw `message` if `error_type` is unrecognized.

### 3. Dashboard (`src/routes/_authenticated/dashboard.tsx`)

- Add a third parallel query: `vendor_monitoring_failures` filtered to the
  vendor ids on the page (`id, vendor_id, error_type, message, checked_at`),
  ordered by `checked_at desc`.
- Build the map via `latestFailureByVendor`.
- Replace the inline `{VENDOR_HEALTH_LABELS[v.health]}` cell in the vendor
  directory table with `<VendorStatusBadge health={v.health}
  failureReason={...} />`.

### 4. `/vendors` list (`src/routes/_authenticated/vendors/index.tsx`)

- Add the alerts fetch (same shape/query as the dashboard's
  `vendor_monitoring_alerts` query) and the failures fetch from above.
- Compute health with the existing `buildDashboardSummary`.
- Add a **Status** column to the table using `VendorStatusBadge`, positioned
  after Risk.

## Testing

- Unit tests for `latestFailureByVendor` in `dashboard-data.test.ts`
  (following existing test patterns in that file).
- No new integration/UI tests — matches the existing pattern where
  `dashboard.tsx` itself isn't directly tested, only its pure data helpers
  are.

## Risks / edge cases

- A vendor can have failures recorded from *before* it last succeeded (e.g.
  failed once, then a later check succeeded and flipped it back to
  `"monitoring"`). Since the badge only shows the tooltip when
  `health === "monitoring_issue"`, a stale failure for a now-healthy vendor
  is never surfaced — no extra filtering needed.
- Failures table has no `resolved`/`status` field, just a timestamped log —
  "most recent" is the correct notion of "current reason," no schema change
  needed to support this.
