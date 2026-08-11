// TanStack Start server function that runs an initial Companies House check
// for one or more vendors right after they're created — so a new vendor
// doesn't sit in "not_monitored" waiting for the next scheduled sweep.
//
// Called fire-and-forget from the vendor creation flows (manual add + bulk
// CSV import) right after the insert succeeds. A failed check here doesn't
// undo vendor creation — the vendor is left as "not_monitored" and picked up
// by the next scheduled sweep instead.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface RunInitialBaselineChecksInput {
  vendorIds: string[];
}

function validateInput(input: RunInitialBaselineChecksInput): RunInitialBaselineChecksInput {
  if (!input || !Array.isArray(input.vendorIds)) {
    throw new Error("vendorIds is required");
  }
  const vendorIds = input.vendorIds.filter((id): id is string => typeof id === "string" && !!id);
  return { vendorIds };
}

const MIN_REQUEST_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const runInitialBaselineChecksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }) => {
    if (data.vendorIds.length === 0) {
      return { checked: 0, failed: 0 };
    }

    // RLS on `vendors` already scopes this to the caller's own rows.
    const { data: vendors, error } = await context.supabase
      .from("vendors")
      .select("id,companies_house_number")
      .in("id", data.vendorIds)
      .not("companies_house_number", "is", null);
    if (error) throw error;

    const { runInitialBaselineCompaniesHouseCheck } = await import("./scheduler.server");

    let checked = 0;
    let failed = 0;
    for (const [index, vendor] of (vendors ?? []).entries()) {
      if (!vendor.companies_house_number) continue;
      if (index > 0) await sleep(MIN_REQUEST_INTERVAL_MS);
      try {
        await runInitialBaselineCompaniesHouseCheck({
          vendorId: vendor.id,
          companyNumber: vendor.companies_house_number,
        });
        checked += 1;
      } catch (err) {
        failed += 1;
        console.error(`Initial baseline check failed for vendor ${vendor.id}:`, err);
      }
    }
    return { checked, failed };
  });
