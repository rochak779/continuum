// TanStack Start server function that runs a Companies House check for a vendor.
//
// This is the app-facing entry point (e.g. a future "Run check now" button).
// The handler runs server-side only; it dynamically imports the server-only
// run-check module so the service-role Supabase client and API key never
// reach the client bundle. Auth is enforced by the attachSupabaseAuth function
// middleware configured in src/start.ts.

import { createServerFn } from "@tanstack/react-start";

export interface CheckVendorInput {
  vendorId: string;
}

function validateInput(input: CheckVendorInput): CheckVendorInput {
  if (!input || typeof input.vendorId !== "string" || !input.vendorId) {
    throw new Error("vendorId is required");
  }
  return { vendorId: input.vendorId };
}

// A "run check now" button only needs to know the outcome, not the full
// snapshot payload (whose normalized_data shape varies by provider) — so the
// handler maps to a small, always-JSON-serializable summary rather than
// returning RunVendorCheckOutcome verbatim.
export interface CheckVendorResult {
  status: "success" | "failed" | "skipped" | "no_identifier";
  runId?: string;
  snapshotId?: string;
  errorType?: string;
  errorMessage?: string;
}

export const checkVendorCompaniesHouseFn = createServerFn({ method: "POST" })
  .validator(validateInput)
  .handler(async ({ data }): Promise<CheckVendorResult> => {
    const { runVendorCompaniesHouseCheck } = await import("./run-check.server");
    const outcome = await runVendorCompaniesHouseCheck(data.vendorId, { triggerType: "manual" });

    switch (outcome.status) {
      case "success":
        return { status: "success", runId: outcome.runId, snapshotId: outcome.snapshotId };
      case "failed":
        return {
          status: "failed",
          runId: outcome.runId,
          errorType: outcome.error.type,
          errorMessage: outcome.error.message,
        };
      case "skipped":
      case "no_identifier":
        return { status: outcome.status };
    }
  });
