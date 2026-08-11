export const VENDOR_COUNTRIES = [
  "United States",
  "United Kingdom",
  "India",
  "Germany",
  "France",
  "Singapore",
  "Australia",
  "Canada",
  "United Arab Emirates",
];

export const VENDOR_CATEGORIES = [
  "Logistics & Supply Chain",
  "IT & Software",
  "Professional Services",
  "Manufacturing",
  "Facilities & Maintenance",
  "Marketing & Media",
  "Financial Services",
];

export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];

/**
 * One vendor row awaiting review, either from the manual "Add Vendor" form
 * (a single row) or a parsed CSV upload (many rows). Fields are kept as raw
 * strings here — validation happens separately via
 * src/lib/vendor-validation.ts so the review table can show per-row errors
 * instead of silently dropping bad data.
 */
export type VendorDraftRow = {
  id: string;
  company_name: string;
  companies_house_number: string;
  country: string;
  category: string;
  internal_owner: string;
  risk_level: string;
  email: string;
  internal_vendor_id: string;
  source: string;
};

const KEY = "continuum.vendor-draft-rows";

export function saveVendorDraftRows(rows: VendorDraftRow[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(rows));
}

export function readVendorDraftRows(): VendorDraftRow[] | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as VendorDraftRow[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function clearVendorDraftRows() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}

// Company Name / Companies House Number / Country are the only columns the
// downloadable template asks for — everything else Companies House can
// supply itself once monitoring picks the vendor up (see
// vendor-validation.ts). The parser (src/lib/csv.ts) still accepts the
// other optional columns via header aliases if a customer's own export
// happens to include them.
export const VENDOR_CSV_TEMPLATE_HEADERS = ["Company Name", "Companies House Number", "Country"];

const VENDOR_CSV_TEMPLATE_EXAMPLE_ROW = ["Acme Logistics Ltd", "09876543", "United Kingdom"];

/** CSV text for the downloadable vendor import template. */
export function vendorCsvTemplate(): string {
  return `${VENDOR_CSV_TEMPLATE_HEADERS.join(",")}\n${VENDOR_CSV_TEMPLATE_EXAMPLE_ROW.join(",")}\n`;
}
