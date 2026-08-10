// TanStack Start server function that runs a Companies House check for a vendor.
//
// This is the app-facing entry point (e.g. a future "Run check now" button).
// The handler runs server-side only; it dynamically imports the server-only
// monitor so the service-role Supabase client and API key never reach the
// client bundle. Auth is enforced by the attachSupabaseAuth function middleware
// configured in src/start.ts.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface CheckVendorInput {
  vendorId: string;
  companyNumber: string;
}

function validateInput(input: CheckVendorInput): CheckVendorInput {
  if (!input || typeof input.vendorId !== "string" || !input.vendorId) {
    throw new Error("vendorId is required");
  }
  if (typeof input.companyNumber !== "string" || !input.companyNumber) {
    throw new Error("companyNumber is required");
  }
  return { vendorId: input.vendorId, companyNumber: input.companyNumber };
}

export const checkVendorCompaniesHouseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }) => {
    const { data: vendor, error } = await context.supabase
      .from("vendors")
      .select("id")
      .eq("id", data.vendorId)
      .maybeSingle();
    if (error) throw error;
    if (!vendor) throw new Error("Vendor not found or is not available to this user");
    const { runVendorCompaniesHouseCheck } = await import("./monitor.server");
    return runVendorCompaniesHouseCheck(data.vendorId, data.companyNumber, {
      persist: true,
    });
  });
