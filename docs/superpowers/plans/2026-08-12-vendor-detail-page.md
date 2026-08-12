# Vendor Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every vendor a read-only detail page (vendor record + latest Companies House snapshot + documents) reachable via a "View Details" link on the vendors list.

**Architecture:** A pure formatter module (`src/lib/vendor-detail.ts`) turns a `vendor_company_snapshots` row's JSON address into a display string — kept separate so it's unit-testable without mounting a component. A new TanStack Router file route (`src/routes/_authenticated/vendors/$vendorId.tsx`) fetches the vendor and its latest snapshot via two Supabase queries and renders three card sections, reusing the existing `VendorDocumentsCell` for documents. The vendors list page gets one new "Actions" column linking into the route.

**Tech Stack:** TanStack Router (file-based routes), TanStack Query, Supabase JS client, Vitest, existing `Field`/card/`AppShell` UI conventions from `src/routes/_authenticated/alerts/$alertId.tsx`.

## Global Constraints

- Read-only page — no editing of vendor fields (per spec: docs/superpowers/specs/2026-08-12-vendor-detail-page-design.md).
- No monitoring alert/failure history on this page (explicitly deferred).
- Reuse `VendorDocumentsCell` unmodified for the documents section.
- Follow the existing `alerts/$alertId.tsx` visual/structural pattern (AppShell, back button, card sections, `Field` dt/dd layout) rather than inventing new patterns.
- Empty state for missing Companies House snapshot: "No Companies House data yet." Not-found state for missing vendor: "This vendor could not be found."

---

### Task 1: Address formatter (`src/lib/vendor-detail.ts`)

**Files:**
- Create: `src/lib/vendor-detail.ts`
- Test: `src/lib/vendor-detail.test.ts`

**Interfaces:**
- Consumes: `CompaniesHouseAddress` type from `src/integrations/companies-house/types.ts` (fields: `address_line_1?`, `address_line_2?`, `locality?`, `region?`, `postal_code?`, `country?`, `premises?`, `po_box?`, all `string | undefined`).
- Produces: `formatRegisteredOfficeAddress(address: CompaniesHouseAddress | null | undefined): string` — joins the present address parts with `", "` in the order `premises, address_line_1, address_line_2, locality, region, postal_code, country` (skipping `po_box`, and skipping any part that's missing/empty), returning `"—"` if no parts are present at all.
- Produces: `formatSicCodes(codes: string[] | null | undefined): string` — returns `codes.join(", ")`, or `"—"` if `codes` is null/undefined/empty.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/vendor-detail.test.ts
import { describe, expect, it } from "vitest";
import { formatRegisteredOfficeAddress, formatSicCodes } from "./vendor-detail";

describe("formatRegisteredOfficeAddress", () => {
  it("joins present address parts in order", () => {
    expect(
      formatRegisteredOfficeAddress({
        premises: "Unit 4",
        address_line_1: "12 High Street",
        locality: "London",
        postal_code: "EC1A 1BB",
        country: "United Kingdom",
      }),
    ).toBe("Unit 4, 12 High Street, London, EC1A 1BB, United Kingdom");
  });

  it("skips missing parts without leaving empty gaps", () => {
    expect(
      formatRegisteredOfficeAddress({
        address_line_1: "12 High Street",
        country: "United Kingdom",
      }),
    ).toBe("12 High Street, United Kingdom");
  });

  it("omits po_box from the formatted output", () => {
    expect(
      formatRegisteredOfficeAddress({
        po_box: "PO Box 123",
        locality: "London",
      }),
    ).toBe("London");
  });

  it("returns an em dash placeholder for null", () => {
    expect(formatRegisteredOfficeAddress(null)).toBe("—");
  });

  it("returns an em dash placeholder for undefined", () => {
    expect(formatRegisteredOfficeAddress(undefined)).toBe("—");
  });

  it("returns an em dash placeholder for an empty object", () => {
    expect(formatRegisteredOfficeAddress({})).toBe("—");
  });
});

describe("formatSicCodes", () => {
  it("joins codes with a comma", () => {
    expect(formatSicCodes(["62012", "70229"])).toBe("62012, 70229");
  });

  it("returns an em dash placeholder for null", () => {
    expect(formatSicCodes(null)).toBe("—");
  });

  it("returns an em dash placeholder for undefined", () => {
    expect(formatSicCodes(undefined)).toBe("—");
  });

  it("returns an em dash placeholder for an empty array", () => {
    expect(formatSicCodes([])).toBe("—");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/vendor-detail.test.ts`
Expected: FAIL — `vendor-detail.ts` does not exist / exports not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/vendor-detail.ts
import type { CompaniesHouseAddress } from "@/integrations/companies-house/types";

/**
 * Formats a Companies House registered-office address (as stored in
 * vendor_company_snapshots.registered_office_address) into a single
 * display line. `po_box` is intentionally excluded — it's rarely present
 * alongside a street address and clutters the line when it is.
 */
export function formatRegisteredOfficeAddress(
  address: CompaniesHouseAddress | null | undefined,
): string {
  if (!address) return "—";
  const parts = [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));
  return parts.length > 0 ? parts.join(", ") : "—";
}

/** Formats SIC codes (as stored in vendor_company_snapshots.sic_codes) for display. */
export function formatSicCodes(codes: string[] | null | undefined): string {
  if (!codes || codes.length === 0) return "—";
  return codes.join(", ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/vendor-detail.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendor-detail.ts src/lib/vendor-detail.test.ts
git commit -m "feat(vendor-detail): add Companies House address/SIC formatters"
```

---

### Task 2: Vendor detail route

**Files:**
- Create: `src/routes/_authenticated/vendors/$vendorId.tsx`

**Interfaces:**
- Consumes: `formatRegisteredOfficeAddress`, `formatSicCodes` from `src/lib/vendor-detail.ts` (Task 1). `VendorDocumentsCell` from `src/components/app/VendorDocumentsCell.tsx` (props: `{ vendorId: string }`, pre-existing, unmodified). `AppShell` from `src/components/app/AppShell.tsx`. `supabase` client from `src/integrations/supabase/client`. Types `Database["public"]["Tables"]["vendors"]["Row"]` and `Database["public"]["Tables"]["vendor_company_snapshots"]["Row"]` from `src/integrations/supabase/types`.
- Produces: route `/_authenticated/vendors/$vendorId`, registered in `routeTree.gen.ts` automatically by the TanStack Router Vite plugin on next `vite dev`/`vite build`/`vitest run` — no manual edit to `routeTree.gen.ts`.

This route has no automated test (consistent with `alerts/$alertId.tsx`, which also has none — it's a straight read/render of existing tables through existing, already-tested query/component building blocks). It's verified manually in Task 4.

- [ ] **Step 1: Write the route file**

```typescript
// src/routes/_authenticated/vendors/$vendorId.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { VendorDocumentsCell } from "@/components/app/VendorDocumentsCell";
import { supabase } from "@/integrations/supabase/client";
import { formatRegisteredOfficeAddress, formatSicCodes } from "@/lib/vendor-detail";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/vendors/$vendorId")({
  head: () => ({
    meta: [
      { title: "Vendor Details | Continuum" },
      {
        name: "description",
        content: "View full vendor details, Companies House data, and documents in Continuum.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: VendorDetailPage,
});

type VendorRow = Tables<"vendors">;
type SnapshotRow = Tables<"vendor_company_snapshots">;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function VendorDetailPage() {
  const { vendorId } = Route.useParams();
  const navigate = useNavigate();

  const {
    data: vendor,
    isLoading: vendorLoading,
    error: vendorError,
  } = useQuery({
    queryKey: ["vendors", "detail", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", vendorId)
        .maybeSingle();
      if (error) throw error;
      return data as VendorRow | null;
    },
  });

  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ["vendors", "detail", vendorId, "companies-house-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_company_snapshots")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as SnapshotRow | null;
    },
    enabled: Boolean(vendor),
  });

  const isLoading = vendorLoading || (Boolean(vendor) && snapshotLoading);

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <button
          type="button"
          onClick={() => navigate({ to: "/vendors" })}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" /> Back to Vendors
        </button>

        {isLoading ? (
          <p className="mt-8 text-muted-foreground">Loading vendor…</p>
        ) : vendorError ? (
          <p className="mt-8 text-sm font-medium text-destructive">
            {vendorError instanceof Error ? vendorError.message : "Could not load this vendor."}
          </p>
        ) : !vendor ? (
          <p className="mt-8 text-muted-foreground">This vendor could not be found.</p>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
              {vendor.company_name}
            </h1>

            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Vendor info</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Company name" value={vendor.company_name} />
                  <Field label="Category" value={vendor.category ?? "—"} />
                  <Field label="Country" value={vendor.country ?? "—"} />
                  <Field label="Internal owner" value={vendor.internal_owner ?? "—"} />
                  <Field label="Risk level" value={vendor.risk_level ?? "—"} />
                  <Field label="Email" value={vendor.email ?? "—"} />
                  <Field label="Internal vendor ID" value={vendor.internal_vendor_id ?? "—"} />
                  <Field label="Monitoring status" value={vendor.monitoring_status} />
                  <Field label="Source" value={vendor.source} />
                  <Field label="Created" value={formatDate(vendor.created_at)} />
                </dl>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Companies House data</h2>
                {!snapshot ? (
                  <p className="mt-4 text-sm text-muted-foreground">No Companies House data yet.</p>
                ) : (
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Company number" value={snapshot.company_number} />
                    <Field label="Company status" value={snapshot.company_status ?? "—"} />
                    <Field label="Company type" value={snapshot.company_type ?? "—"} />
                    <Field label="Date of incorporation" value={formatDate(snapshot.date_of_creation)} />
                    <Field
                      label="Registered office address"
                      value={formatRegisteredOfficeAddress(
                        snapshot.registered_office_address as
                          | { address_line_1?: string; address_line_2?: string; locality?: string; region?: string; postal_code?: string; country?: string; premises?: string; po_box?: string }
                          | null,
                      )}
                    />
                    <Field label="SIC codes" value={formatSicCodes(snapshot.sic_codes)} />
                    <Field label="Accounts next due" value={formatDate(snapshot.accounts_next_due)} />
                    <Field
                      label="Confirmation statement next due"
                      value={formatDate(snapshot.confirmation_statement_next_due)}
                    />
                  </dl>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Documents</h2>
                <div className="mt-4">
                  <VendorDocumentsCell vendorId={vendor.id} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 whitespace-pre-line text-sm text-foreground">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Regenerate the route tree and typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (running `vite dev` or `tsc --noEmit` with the TanStack Router Vite plugin active regenerates `src/routeTree.gen.ts` to include the new `$vendorId` route; if it doesn't pick up automatically, run `npx vite build` once to force generation, then re-run `tsc --noEmit`).

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/vendors/\$vendorId.tsx src/routeTree.gen.ts
git commit -m "feat(vendor-detail): add vendor detail route"
```

---

### Task 3: "View Details" entry point on the vendors list

**Files:**
- Modify: `src/routes/_authenticated/vendors/index.tsx`

**Interfaces:**
- Consumes: route `/vendors/$vendorId` from Task 2, TanStack Router's `Link` component (already used elsewhere in the codebase, e.g. `AppShell.tsx`).
- Produces: no new exports — this is a leaf UI change.

- [ ] **Step 1: Add the `Link` import**

In `src/routes/_authenticated/vendors/index.tsx`, change:

```typescript
import { createFileRoute } from "@tanstack/react-router";
```

to:

```typescript
import { createFileRoute, Link } from "@tanstack/react-router";
```

- [ ] **Step 2: Add the "Actions" column header**

Change the `<thead>` row (`src/routes/_authenticated/vendors/index.tsx:96-103`) from:

```tsx
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Owner</th>
                <th className="px-6 py-4">Risk</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Documents</th>
```

to:

```tsx
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Owner</th>
                <th className="px-6 py-4">Risk</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Documents</th>
                <th className="px-6 py-4">Actions</th>
```

- [ ] **Step 3: Add the "View Details" cell**

Change the row's last `<td>` (documents cell, `src/routes/_authenticated/vendors/index.tsx:121-123`) from:

```tsx
                  <td className="px-6 py-4">
                    <VendorDocumentsCell vendorId={v.id} />
                  </td>
                </tr>
```

to:

```tsx
                  <td className="px-6 py-4">
                    <VendorDocumentsCell vendorId={v.id} />
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      to="/vendors/$vendorId"
                      params={{ vendorId: v.id }}
                      className="font-medium text-primary hover:underline"
                    >
                      View Details
                    </Link>
                  </td>
                </tr>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the `Link to="/vendors/$vendorId"` route id and `params` shape match the route generated in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/vendors/index.tsx
git commit -m "feat(vendor-detail): link vendors list rows to detail page"
```

---

### Task 4: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, including the new `src/lib/vendor-detail.test.ts` tests.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Start the dev server and manually verify both states**

Run: `npm run dev`, then in a browser:
- Go to `/vendors`, confirm the new "Actions" column with "View Details" links renders.
- Click "View Details" on a vendor that has a `vendor_company_snapshots` row and uploaded documents — confirm all three cards render with real data, and the documents card's upload/download/delete still works.
- Click "View Details" on a vendor with no Companies House snapshot yet — confirm the "No Companies House data yet." empty state renders instead of an error.
- Navigate directly to `/vendors/<a-nonexistent-uuid>` — confirm "This vendor could not be found." renders instead of a crash.

Expected: all four checks pass visually; no console errors.

- [ ] **Step 4: Commit any fixes found during manual verification**

If manual verification surfaces a bug, fix it, re-run steps 1–3, then:

```bash
git add -A
git commit -m "fix(vendor-detail): <describe the fix>"
```

If no bugs found, no commit needed for this task.
