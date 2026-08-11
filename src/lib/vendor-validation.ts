// Single source of truth for what makes a vendor record valid, shared by the
// manual "Add Vendor" form (src/routes/_authenticated/vendors/new.tsx) and
// the CSV bulk-import review table (src/routes/_authenticated/vendors/review.tsx).
//
// `company_name` and `companies_house_number` are the only two required
// fields. `companies_house_number` is required deliberately: it's the field
// that actually turns on Companies House monitoring (see the
// sync_companies_house_monitoring_config trigger in
// supabase/migrations/20260810170000_scheduled_monitoring.sql) — a vendor
// created without it can never leave monitoring_status "not_monitored".
//
// country/category/internal_owner/risk_level/email are internal-only
// judgments Companies House has no concept of (it can't tell you who owns a
// vendor internally or how risky you consider them), so they're optional
// here — left for the customer to fill in later, once an edit-vendor screen
// exists (it doesn't yet as of this writing). Formats are still validated
// when a value is provided.

import { z } from "zod";

import { normaliseCompanyNumber } from "@/integrations/companies-house/client";

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v ?? "");

export const vendorFieldsSchema = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(120),
  companies_house_number: z
    .string()
    .trim()
    .min(1, "Companies House number is required")
    .transform((value, ctx) => {
      const normalised = normaliseCompanyNumber(value);
      if (!normalised) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Not a valid Companies House number (8 characters, e.g. 09876543)",
        });
        return z.NEVER;
      }
      return normalised;
    }),
  country: optionalTrimmed(120),
  category: optionalTrimmed(120),
  internal_owner: optionalTrimmed(120),
  risk_level: optionalTrimmed(60),
  email: z
    .string()
    .trim()
    .max(255)
    .optional()
    .transform((v) => v ?? "")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Enter a valid vendor email",
    }),
  internal_vendor_id: z.string().trim().max(60).optional().transform((v) => v ?? ""),
});

export type VendorFields = z.infer<typeof vendorFieldsSchema>;
export type VendorFieldName = keyof z.infer<typeof vendorFieldsSchema>;

export interface VendorRowValidation {
  valid: boolean;
  data: VendorFields | null;
  fieldErrors: Partial<Record<VendorFieldName, string>>;
}

/** Validates one vendor row (manual form or a single CSV row). Never throws. */
export function validateVendorRow(row: Record<string, string>): VendorRowValidation {
  const result = vendorFieldsSchema.safeParse(row);
  if (result.success) {
    return { valid: true, data: result.data, fieldErrors: {} };
  }
  const fieldErrors: Partial<Record<VendorFieldName, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in fieldErrors)) {
      fieldErrors[key as VendorFieldName] = issue.message;
    }
  }
  return { valid: false, data: null, fieldErrors };
}
