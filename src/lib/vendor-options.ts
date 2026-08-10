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

export type VendorDraft = {
  company_name: string;
  country: string;
  category: string;
  internal_owner: string;
  risk_level: string;
  email: string;
  internal_vendor_id: string;
  source: string;
  file_name?: string;
};

const KEY = "continuum.vendor-draft";

export function saveVendorDraft(draft: VendorDraft) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(draft));
}

export function readVendorDraft(): VendorDraft | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VendorDraft;
  } catch {
    return null;
  }
}

export function clearVendorDraft() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}
