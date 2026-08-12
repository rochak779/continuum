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
