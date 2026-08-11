# Monitoring Failure Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a vendor's "Monitoring Issue" status self-explanatory by surfacing the most recent Companies House check failure reason as a tooltip, on both the dashboard and the `/vendors` list — and give `/vendors` a Status column at all, since it currently has none.

**Architecture:** Two pure, unit-tested helpers in `src/lib/dashboard-data.ts` (dedupe failures to one-per-vendor, humanize the error type into a label) feed a new shared `VendorStatusBadge` component. Both route components (`dashboard.tsx`, `vendors/index.tsx`) fetch `vendor_monitoring_failures` alongside their existing queries and pass the derived reason into the badge. No schema or backend changes — `vendor_monitoring_failures` already has everything needed and is already RLS-scoped to the owner.

**Tech Stack:** React, TanStack Router/Query, Supabase JS client, Vitest, Tailwind v4 (CSS custom properties as utility classes, e.g. `text-warning`), lucide-react icons.

## Global Constraints

- No new UI dependency for tooltips — use the native `title` attribute, consistent with the codebase's current lack of a tooltip component.
- No schema/backend changes.
- No vendor detail page, no retry-from-UI action, no failure history view — most-recent reason only.
- Match existing test style: plain Vitest `describe`/`it`, no React component tests (matches current pattern where `dashboard.tsx` itself isn't directly tested, only its pure data helpers are).

---

### Task 1: Failure-dedupe and label helpers in `dashboard-data.ts`

**Files:**
- Modify: `src/lib/dashboard-data.ts`
- Test: `src/lib/dashboard-data.test.ts`

**Interfaces:**
- Consumes: nothing new (pure functions, no external deps).
- Produces:
  - `export interface DashboardFailure { vendor_id: string; error_type: string; message: string | null; checked_at: string; }`
  - `export function latestFailureByVendor(failures: readonly DashboardFailure[]): Map<string, DashboardFailure>`
  - `export function describeFailure(failure: DashboardFailure): string`

These are consumed by Task 2 (`VendorStatusBadge`) and Tasks 3–4 (route components).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboard-data.test.ts`:

```ts
import { describeFailure, latestFailureByVendor } from "./dashboard-data";

describe("latestFailureByVendor", () => {
  it("keeps only the most recent failure per vendor", () => {
    const result = latestFailureByVendor([
      { vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" },
      { vendor_id: "v1", error_type: "rate_limited", message: null, checked_at: "2026-08-03T00:00:00Z" },
      { vendor_id: "v2", error_type: "timeout", message: null, checked_at: "2026-08-02T00:00:00Z" },
    ]);

    expect(result.size).toBe(2);
    expect(result.get("v1")?.error_type).toBe("rate_limited");
    expect(result.get("v2")?.error_type).toBe("timeout");
  });

  it("does not assume input is pre-sorted", () => {
    const result = latestFailureByVendor([
      { vendor_id: "v1", error_type: "rate_limited", message: null, checked_at: "2026-08-03T00:00:00Z" },
      { vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" },
    ]);

    expect(result.get("v1")?.error_type).toBe("rate_limited");
  });

  it("returns an empty map for no failures", () => {
    expect(latestFailureByVendor([]).size).toBe(0);
  });
});

describe("describeFailure", () => {
  it("maps known error types to a human label", () => {
    expect(
      describeFailure({ vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" }),
    ).toBe("Company not found");
  });

  it("falls back to the raw message for an unknown error type", () => {
    expect(
      describeFailure({
        vendor_id: "v1",
        error_type: "something_new",
        message: "Unexpected 503 from provider",
        checked_at: "2026-08-01T00:00:00Z",
      }),
    ).toBe("Unexpected 503 from provider");
  });

  it("falls back to a generic label with no error type match or message", () => {
    expect(
      describeFailure({ vendor_id: "v1", error_type: "something_new", message: null, checked_at: "2026-08-01T00:00:00Z" }),
    ).toBe("Monitoring check failed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dashboard-data.test.ts`
Expected: FAIL — `latestFailureByVendor` and `describeFailure` are not exported from `./dashboard-data`.

- [ ] **Step 3: Implement the helpers**

Add to `src/lib/dashboard-data.ts` (after the existing `DashboardSummary` interface, before `monitoringStatus`):

```ts
export interface DashboardFailure {
  vendor_id: string;
  error_type: string;
  message: string | null;
  checked_at: string;
}

/**
 * Reduces a list of monitoring failure rows (which may include multiple
 * historical failures per vendor, in any order) to the single most recent
 * failure per vendor.
 */
export function latestFailureByVendor(
  failures: readonly DashboardFailure[],
): Map<string, DashboardFailure> {
  const latest = new Map<string, DashboardFailure>();
  for (const failure of failures) {
    const current = latest.get(failure.vendor_id);
    if (!current || new Date(failure.checked_at) > new Date(current.checked_at)) {
      latest.set(failure.vendor_id, failure);
    }
  }
  return latest;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  invalid_company_number: "Invalid company number",
  not_found: "Company not found",
  unauthorized: "Monitoring credentials rejected",
  rate_limited: "Rate limited by Companies House",
  unavailable: "Companies House unavailable",
  timeout: "Request to Companies House timed out",
  malformed_response: "Unexpected response from Companies House",
  network_error: "Network error contacting Companies House",
};

/** Humanizes a failure into a short label suitable for a tooltip. */
export function describeFailure(failure: DashboardFailure): string {
  return ERROR_TYPE_LABELS[failure.error_type] ?? failure.message ?? "Monitoring check failed";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dashboard-data.test.ts`
Expected: PASS, all tests including the pre-existing `buildDashboardSummary` test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-data.ts src/lib/dashboard-data.test.ts
git commit -m "feat(monitoring): add failure dedupe and label helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `VendorStatusBadge` shared component

**Files:**
- Create: `src/components/app/VendorStatusBadge.tsx`

**Interfaces:**
- Consumes: `VENDOR_HEALTH_LABELS`, `type VendorHealth` from `@/lib/vendor-health` (existing, unchanged).
- Produces: `export function VendorStatusBadge({ health, failureReason }: { health: VendorHealth; failureReason?: string | undefined }): JSX.Element` — consumed by Tasks 3 and 4.

No test file — this is presentational JSX glue over already-tested helpers, matching the "no new UI dependency, no component tests" constraint. Verified visually in Task 3/4's manual check instead.

- [ ] **Step 1: Create the component**

```tsx
import { AlertTriangle } from "lucide-react";

import { VENDOR_HEALTH_LABELS, type VendorHealth } from "@/lib/vendor-health";

export function VendorStatusBadge({
  health,
  failureReason,
}: {
  health: VendorHealth;
  failureReason?: string | undefined;
}) {
  const label = VENDOR_HEALTH_LABELS[health];

  if (health !== "monitoring_issue" || !failureReason) {
    return <span className="text-muted-foreground">{label}</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground"
      title={failureReason}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/VendorStatusBadge.tsx
git commit -m "feat(monitoring): add VendorStatusBadge component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire failure reasons into the dashboard vendor directory

**Files:**
- Modify: `src/routes/_authenticated/dashboard.tsx`

**Interfaces:**
- Consumes: `latestFailureByVendor`, `describeFailure`, `type DashboardFailure` from `@/lib/dashboard-data` (Task 1); `VendorStatusBadge` from `@/components/app/VendorStatusBadge` (Task 2).
- Produces: nothing new for other tasks — this is a leaf route component.

- [ ] **Step 1: Import the new helpers and component**

In `src/routes/_authenticated/dashboard.tsx`, update the import block:

```tsx
import { buildDashboardSummary, describeFailure, latestFailureByVendor } from "@/lib/dashboard-data";
```

and add:

```tsx
import { VendorStatusBadge } from "@/components/app/VendorStatusBadge";
```

- [ ] **Step 2: Fetch failures alongside vendors/alerts/changes**

In the `queryFn` (around `src/routes/_authenticated/dashboard.tsx:79-107`), add a fourth parallel query and destructure it:

```tsx
const [vendorsResult, alertsResult, changesResult, failuresResult] = await Promise.all([
  supabase
    .from("vendors")
    .select("id, company_name, category, risk_level, monitoring_status, created_at")
    .order("created_at", { ascending: false }),
  supabase
    .from("vendor_monitoring_alerts")
    .select("id, vendor_id, severity, status, attribute_checked, detected_at")
    .neq("status", "resolved")
    .order("detected_at", { ascending: false }),
  supabase
    .from("vendor_change_events")
    .select(
      "id, vendor_id, attribute_key, previous_value, new_value, severity, detected_at, snapshot_id",
    )
    .in("severity", ["critical", "attention"])
    .order("detected_at", { ascending: false })
    .limit(5),
  supabase
    .from("vendor_monitoring_failures")
    .select("vendor_id, error_type, message, checked_at")
    .order("checked_at", { ascending: false }),
]);
if (vendorsResult.error) throw vendorsResult.error;
if (alertsResult.error) throw alertsResult.error;
if (changesResult.error) throw changesResult.error;
if (failuresResult.error) throw failuresResult.error;
return {
  vendors: vendorsResult.data,
  alerts: alertsResult.data,
  changes: changesResult.data,
  failures: failuresResult.data,
};
```

- [ ] **Step 3: Derive the latest-failure map**

After the existing `const alerts = data?.alerts ?? [];` / `const changes = data?.changes ?? [];` lines (around line 111-112), add:

```tsx
const failures = data?.failures ?? [];
const failureByVendor = latestFailureByVendor(failures);
```

- [ ] **Step 4: Render the badge in the vendor directory table**

Replace the Status cell (`src/routes/_authenticated/dashboard.tsx:436`):

```tsx
<td className="py-4 text-muted-foreground">{VENDOR_HEALTH_LABELS[v.health]}</td>
```

with:

```tsx
<td className="py-4">
  <VendorStatusBadge
    health={v.health}
    failureReason={
      failureByVendor.has(v.id) ? describeFailure(failureByVendor.get(v.id)!) : undefined
    }
  />
</td>
```

- [ ] **Step 5: Remove the now-unused `VENDOR_HEALTH_LABELS` import if no longer referenced elsewhere in the file**

Check remaining usages:

Run: `grep -n "VENDOR_HEALTH_LABELS" src/routes/_authenticated/dashboard.tsx`

The healthy/attention/critical/monitoring-issue legend under the pie chart (around line 253-260) uses `healthData`, not `VENDOR_HEALTH_LABELS` directly, but `healthData` is built from `VENDOR_HEALTH_LABELS` at line 124-128 — so the import stays. Confirm the import line still reads:

```tsx
import { VENDOR_HEALTH_LABELS, type VendorHealth } from "@/lib/vendor-health";
```

unchanged (no action needed if `grep` still shows a usage at the `healthData` construction).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev` (or confirm the existing dev server on port 5183 picks up the change via HMR), then in a browser with a signed-in session that has at least one vendor with `monitoring_status = 'failing'` and a row in `vendor_monitoring_failures`:
- Confirm the dashboard's Vendor Directory table shows "Monitoring Issue" with a small warning icon for that vendor.
- Hover the status cell and confirm the browser's native tooltip shows the humanized reason (e.g. "Company not found").
- Confirm vendors with `monitoring_status = 'monitoring'` still show their normal health label with no icon/tooltip.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx
git commit -m "feat(monitoring): show failure reason tooltip on dashboard status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Add a Status column with failure reasons to `/vendors`

**Files:**
- Modify: `src/routes/_authenticated/vendors/index.tsx`

**Interfaces:**
- Consumes: `buildDashboardSummary` from `@/lib/dashboard-data` (existing); `latestFailureByVendor`, `describeFailure` from `@/lib/dashboard-data` (Task 1); `VendorStatusBadge` from `@/components/app/VendorStatusBadge` (Task 2).
- Produces: nothing new for other tasks — leaf route component.

`/vendors` currently does `select("*")` with no alerts fetch, so it cannot compute health. This task adds the alerts + failures fetch and health computation, mirroring the dashboard's pattern.

- [ ] **Step 1: Update imports**

In `src/routes/_authenticated/vendors/index.tsx`, replace the import block with:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { AddVendorModal } from "@/components/app/AddVendorModal";
import { VendorStatusBadge } from "@/components/app/VendorStatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { buildDashboardSummary, describeFailure, latestFailureByVendor } from "@/lib/dashboard-data";
```

- [ ] **Step 2: Fetch vendors, alerts, and failures together**

Replace the existing `useQuery` block (`src/routes/_authenticated/vendors/index.tsx:30-40`):

```tsx
const { data: vendors, isLoading } = useQuery({
  queryKey: ["vendors", "list"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});
```

with:

```tsx
const { data, isLoading } = useQuery({
  queryKey: ["vendors", "list"],
  queryFn: async () => {
    const [vendorsResult, alertsResult, failuresResult] = await Promise.all([
      supabase.from("vendors").select("*").order("created_at", { ascending: false }),
      supabase
        .from("vendor_monitoring_alerts")
        .select("id, vendor_id, severity, status, attribute_checked, detected_at")
        .neq("status", "resolved"),
      supabase
        .from("vendor_monitoring_failures")
        .select("vendor_id, error_type, message, checked_at")
        .order("checked_at", { ascending: false }),
    ]);
    if (vendorsResult.error) throw vendorsResult.error;
    if (alertsResult.error) throw alertsResult.error;
    if (failuresResult.error) throw failuresResult.error;
    return {
      vendors: vendorsResult.data,
      alerts: alertsResult.data,
      failures: failuresResult.data,
    };
  },
});

const vendors = data?.vendors ?? [];
const summary = buildDashboardSummary(
  vendors,
  (data?.alerts ?? []).map((alert) => ({
    ...alert,
    severity:
      alert.severity === "critical" || alert.severity === "info" ? alert.severity : "attention",
  })),
);
const failureByVendor = latestFailureByVendor(data?.failures ?? []);
```

- [ ] **Step 3: Update the loading/empty checks**

Replace `!vendors?.length` (line 54) with `!vendors.length` (it's now a plain array via `?? []`, not possibly `undefined`):

```tsx
) : !vendors.length ? (
```

- [ ] **Step 4: Add the Status column header**

In the `<thead>` (`src/routes/_authenticated/vendors/index.tsx:58-65`), add a header after Risk:

```tsx
<tr>
  <th className="px-6 py-4">Company</th>
  <th className="px-6 py-4">Category</th>
  <th className="px-6 py-4">Country</th>
  <th className="px-6 py-4">Owner</th>
  <th className="px-6 py-4">Risk</th>
  <th className="px-6 py-4">Status</th>
</tr>
```

- [ ] **Step 5: Render the badge in each row**

In the `<tbody>` map (`src/routes/_authenticated/vendors/index.tsx:68-76`), add a cell after Risk:

```tsx
{vendors.map((v) => (
  <tr key={v.id} className="border-t border-border">
    <td className="px-6 py-4 font-semibold text-foreground">{v.company_name}</td>
    <td className="px-6 py-4 text-muted-foreground">{v.category}</td>
    <td className="px-6 py-4 text-muted-foreground">{v.country}</td>
    <td className="px-6 py-4 text-muted-foreground">{v.internal_owner}</td>
    <td className="px-6 py-4 text-muted-foreground">{v.risk_level}</td>
    <td className="px-6 py-4">
      <VendorStatusBadge
        health={summary.healthByVendor.get(v.id) ?? "monitoring_issue"}
        failureReason={
          failureByVendor.has(v.id) ? describeFailure(failureByVendor.get(v.id)!) : undefined
        }
      />
    </td>
  </tr>
))}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

With the same signed-in session as Task 3's manual check, navigate to `/vendors`:
- Confirm a Status column now appears with correct health labels for every vendor.
- Confirm the vendor with a recorded failure shows the warning icon and tooltip, matching what the dashboard shows for the same vendor.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/vendors/index.tsx
git commit -m "feat(monitoring): add Status column to vendors list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `latestFailureByVendor`/`describeFailure` tests from Task 1 and the pre-existing suite (no regressions).

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint` (check `package.json` for the exact script name if this differs)
Expected: no new lint errors on the changed files.

- [ ] **Step 4: Confirm no leftover references to the old inline status rendering**

Run: `grep -n "VENDOR_HEALTH_LABELS\[v.health\]" src/routes/_authenticated/dashboard.tsx`
Expected: no matches (replaced by `VendorStatusBadge` in Task 3).
