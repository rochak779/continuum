# Dashboard "View All" Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard's three "View All" buttons navigate to real, complete screens.

**Architecture:** Two new route files (`/changes`, `/expiries`) follow the query pattern the already-merged `/alerts` fix established: `supabase.from(<table>).select("...columns..., vendors ( company_name )")` (nested-select embed), ordered, unlimited. `displayValue` moves from being private to `dashboard.tsx` into the shared `src/lib/alert-labels.ts` so `/changes` can reuse it. The dashboard's `Panel` component's `action` prop changes from a plain string to a `{ label, to }` pair rendering a real `Link`.

**Tech Stack:** TanStack Router (file-based routes, typed `Link`), TanStack Query, Supabase JS client (typed, via generated `src/integrations/supabase/types.ts`), Vitest.

## Global Constraints

- Base this work on top of `origin/main` (which already includes PR #10's `/alerts` fix and PR #11's vendor-detail-page) — not the stale local `feat/vendor-detail-page` branch, which predates PR #10.
- `vendor_monitoring_alerts`, `vendor_change_events`, `vendor_documents`, and `vendors` are all present in the generated `Database` types (`src/integrations/supabase/types.ts`) — use the typed `supabase` client directly, no untyped-client casts.
- Follow the pattern `src/routes/_authenticated/alerts/index.tsx` already uses on `main`: a single `supabase.from(<table>).select("...columns..., vendors ( company_name )")` query (nested-select embed) rather than a separate vendors query joined client-side. Each table used here (`vendor_change_events`, `vendor_documents`) has exactly one foreign key to `vendors`, so the embed is unambiguous.
- Do not modify `AlertResolutionPanel.tsx`, `resolve-alert-fn.ts`, `resolve-alert.server.ts`, or anything under `src/routes/_authenticated/alerts/` — already fixed and out of scope here.
- Route component files (`.tsx` under `src/routes/`) have no `.test.ts` files anywhere in this codebase — only pure functions in `src/lib/` do. New/modified route files are verified by `npm run lint` and `npm run build` (which also typechecks, since `tsconfig.json` has `"noEmit": true`), not by adding route tests.
- After adding a new route file, `src/routeTree.gen.ts` must be regenerated (it's a committed, generated file) by running `npm run build`, and the resulting diff committed alongside the route file.

---

## Task 1: Share `displayValue` via `src/lib/alert-labels.ts`

**Files:**
- Modify: `src/lib/alert-labels.ts`
- Create: `src/lib/alert-labels.test.ts`
- Modify: `src/routes/_authenticated/dashboard.tsx`

**Interfaces:**
- Produces: `displayValue(value: Json | null): string`, exported from `src/lib/alert-labels.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/alert-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { displayValue } from "./alert-labels";

describe("displayValue", () => {
  it("renders null as 'Not provided'", () => {
    expect(displayValue(null)).toBe("Not provided");
  });

  it("joins array values with a comma", () => {
    expect(displayValue(["62020", "62090"])).toBe("62020, 62090");
  });

  it("joins object values, dropping falsy entries", () => {
    expect(
      displayValue({ locality: "London", region: null, postal_code: "EC1A 1BB" }),
    ).toBe("London, EC1A 1BB");
  });

  it("stringifies primitive values", () => {
    expect(displayValue("active")).toBe("active");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- alert-labels`
Expected: FAIL — `displayValue` is not exported from `./alert-labels`.

- [ ] **Step 3: Add `displayValue` to `alert-labels.ts`**

Add near the top of `src/lib/alert-labels.ts`, alongside its existing imports (there are none yet — this adds the file's first import):

```ts
import type { Json } from "@/integrations/supabase/types";
```

Add at the end of the file:

```ts
/** Renders a change-event jsonb value (string, array, or object) as plain text. */
export function displayValue(value: Json | null): string {
  if (value === null) return "Not provided";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return Object.values(value).filter(Boolean).join(", ");
  return String(value);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- alert-labels`
Expected: PASS, all four cases.

- [ ] **Step 5: Update `dashboard.tsx` to import instead of defining locally**

In `src/routes/_authenticated/dashboard.tsx`, remove the local `displayValue` function (currently defined right after the `HEALTH_COLORS` constant, before `function initials`).

Update the existing import:

```ts
import { alertAttributeLabel, describeAlertReason } from "@/lib/alert-labels";
```

to:

```ts
import { alertAttributeLabel, describeAlertReason, displayValue } from "@/lib/alert-labels";
```

- [ ] **Step 6: Run lint and the full test suite**

Run: `npm run lint && npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/alert-labels.ts src/lib/alert-labels.test.ts src/routes/_authenticated/dashboard.tsx
git commit -m "refactor(dashboard): share displayValue via alert-labels.ts"
```

---

## Task 2: New `/changes` screen — all material changes

**Files:**
- Create: `src/routes/_authenticated/changes.tsx`
- Modify: `src/routeTree.gen.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `alertAttributeLabel`, `displayValue` from `@/lib/alert-labels` (Task 1 for `displayValue`; `alertAttributeLabel` already exists on `main`)

- [ ] **Step 1: Create the route file**

Create `src/routes/_authenticated/changes.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { TrendingDown, UserCog } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { alertAttributeLabel, displayValue } from "@/lib/alert-labels";

export const Route = createFileRoute("/_authenticated/changes")({
  head: () => ({
    meta: [
      { title: "Material Changes | Continuum" },
      {
        name: "description",
        content: "Every change detected across your monitored vendors, newest first.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ChangesPage,
});

interface ChangeRow {
  id: string;
  vendor_id: string;
  attribute_key: string;
  previous_value: unknown;
  new_value: unknown;
  severity: string;
  detected_at: string;
  vendors: { company_name: string } | null;
}

function vendorName(vendor: ChangeRow["vendors"]): string {
  return vendor?.company_name ?? "Unknown vendor";
}

function ChangesPage() {
  const { data: changes, isLoading } = useQuery({
    queryKey: ["changes", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_change_events")
        .select(
          "id, vendor_id, attribute_key, previous_value, new_value, severity, detected_at, vendors ( company_name )",
        )
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ChangeRow[];
    },
  });

  const rows = changes ?? [];

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Material Changes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change detected across your monitored vendors, newest first.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-card">
        {isLoading ? (
          <p className="text-muted-foreground">Loading changes…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No changes detected yet.</p>
        ) : (
          <div className="space-y-5">
            {rows.map((change) => {
              const Icon = change.severity === "critical" ? TrendingDown : UserCog;
              return (
                <div key={change.id} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm text-foreground">
                      <Link
                        to="/vendors/$vendorId"
                        params={{ vendorId: change.vendor_id }}
                        className="font-semibold hover:text-primary hover:underline"
                      >
                        {vendorName(change.vendors)}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {alertAttributeLabel(change.attribute_key)} changed
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {displayValue(change.previous_value as never)} →{" "}
                      {displayValue(change.new_value as never)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(change.detected_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run build`
Expected: succeeds; `src/routeTree.gen.ts` now has a new entry for `/_authenticated/changes`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/changes.tsx src/routeTree.gen.ts
git commit -m "feat(dashboard): add /changes screen listing all material changes"
```

---

## Task 3: New `/expiries` screen — all upcoming document expiries

**Files:**
- Create: `src/routes/_authenticated/expiries.tsx`
- Modify: `src/routeTree.gen.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: `buildUpcomingExpiries` from `@/lib/dashboard-data` (existing, unchanged)

- [ ] **Step 1: Create the route file**

Create `src/routes/_authenticated/expiries.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { buildUpcomingExpiries } from "@/lib/dashboard-data";

export const Route = createFileRoute("/_authenticated/expiries")({
  head: () => ({
    meta: [
      { title: "Upcoming Reviews & Expiries | Continuum" },
      {
        name: "description",
        content: "Every upcoming document expiry across your monitored vendors, soonest first.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ExpiriesPage,
});

function ExpiriesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["expiries", "list"],
    queryFn: async () => {
      const { data: documents, error } = await supabase
        .from("vendor_documents")
        .select("id, vendor_id, item_label, file_name, expiry_date")
        .not("expiry_date", "is", null)
        .gte("expiry_date", new Date().toISOString().slice(0, 10))
        .order("expiry_date", { ascending: true });
      if (error) throw error;

      const vendorIds = [...new Set(documents.map((d) => d.vendor_id))];
      const { data: vendors, error: vendorsError } =
        vendorIds.length === 0
          ? { data: [] as Array<{ id: string; company_name: string }>, error: null }
          : await supabase.from("vendors").select("id, company_name").in("id", vendorIds);
      if (vendorsError) throw vendorsError;

      return { documents, vendors };
    },
  });

  const documents = data?.documents ?? [];
  const vendorIdByDocument = new Map(documents.map((doc) => [doc.id, doc.vendor_id]));
  const vendorNames = new Map((data?.vendors ?? []).map((v) => [v.id, v.company_name]));
  const expiries = buildUpcomingExpiries(documents, vendorNames);

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Upcoming Reviews &amp; Expiries
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every document with an upcoming expiry date, soonest first.
        </p>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-card">
        {isLoading ? (
          <p className="text-muted-foreground">Loading upcoming expiries…</p>
        ) : expiries.length === 0 ? (
          <p className="text-muted-foreground">No upcoming reviews or expiries.</p>
        ) : (
          <div className="space-y-4">
            {expiries.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <Link
                    to="/vendors/$vendorId"
                    params={{ vendorId: vendorIdByDocument.get(row.id) ?? "" }}
                    className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
                  >
                    {row.companyName}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{row.item}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {new Date(`${row.expiryDate}T00:00:00`).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

Note: this route fetches vendors filtered to just the referenced ids (`.in("id", vendorIds)`) rather than the whole table — a small, deliberate deviation from the `/changes` nested-embed pattern, since `vendor_documents` isn't the same table `/alerts` established the embed convention on and this keeps the query minimal for a page that's typically all-future-dated documents across possibly many vendors.

- [ ] **Step 2: Regenerate the route tree**

Run: `npm run build`
Expected: succeeds; `src/routeTree.gen.ts` now also has an entry for `/_authenticated/expiries`.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/expiries.tsx src/routeTree.gen.ts
git commit -m "feat(dashboard): add /expiries screen listing all upcoming document expiries"
```

---

## Task 4: Wire the dashboard's "View All" buttons

**Files:**
- Modify: `src/routes/_authenticated/dashboard.tsx`

**Interfaces:**
- Consumes: routes `/alerts` (already on `main`), `/changes` (Task 2), `/expiries` (Task 3) — all must exist before this task runs.

- [ ] **Step 1: Change the `Panel` component's `action` prop to a link**

Find the `Panel` function (near the bottom of `dashboard.tsx`, after `MetricCard`) and replace it:

```tsx
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; to: "/alerts" | "/changes" | "/expiries" };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {action && (
          <Link to={action.to} className="text-sm font-semibold text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Update the three panel usages**

Change:

```tsx
<Panel title="Upcoming Reviews & Expiries" action="View All">
```

to:

```tsx
<Panel title="Upcoming Reviews & Expiries" action={{ label: "View All", to: "/expiries" }}>
```

Change:

```tsx
<Panel title="Recent Material Changes" action="View All">
```

to:

```tsx
<Panel title="Recent Material Changes" action={{ label: "View All", to: "/changes" }}>
```

Change:

```tsx
<Panel title="Actions Requiring Attention" action="View All Tasks">
```

to:

```tsx
<Panel title="Actions Requiring Attention" action={{ label: "View All Tasks", to: "/alerts" }}>
```

- [ ] **Step 3: Run lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed — the `to` values are checked against `routeTree.gen.ts` by TanStack Router's typed `Link`, so a typo here would be a build-time error, not a runtime one.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (unchanged — this task touches no tested logic, only JSX wiring).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx
git commit -m "feat(dashboard): wire View All buttons to /alerts, /changes, /expiries"
```

---

## Self-Review Notes

- **Spec coverage:** Design §1 (shared `displayValue`) → Task 1. §2 (`/changes`) → Task 2. §3 (`/expiries`) → Task 3. §4 (wire dashboard buttons) → Task 4.
- **Ordering:** Task 1 before Task 2 (needs `displayValue`). Tasks 2-3 before Task 4 (the `Link to=` values must exist in `routeTree.gen.ts`, which TanStack Router's typed router enforces at build time).
- **Type consistency:** `displayValue`'s signature (`(value: Json | null) => string`) is unchanged from its `dashboard.tsx`-private form, so no call site needed to change shape — only import source. `/changes`'s `ChangeRow` interface matches the exact columns selected in its query.
- **Superseded work:** the original version of this plan's Tasks 2-3 (fixing `/alerts` and `/alerts/$alertId`) is dropped — that work is already merged to `main` via PR #10, discovered when starting this plan's worktree. See the spec's Revision note.
