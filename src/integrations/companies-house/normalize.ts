// Convert a raw Companies House profile into our normalised internal snapshot.
// Pure function — no I/O — so it is trivial to unit test.

import type {
  CompaniesHouseAddress,
  CompaniesHouseRawProfile,
  NormalisedCompanySnapshot,
} from "./types";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanAddress(address: CompaniesHouseAddress | undefined): CompaniesHouseAddress | null {
  if (!address || typeof address !== "object") return null;
  const entries = Object.entries(address).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0,
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as CompaniesHouseAddress) : null;
}

/**
 * Derive a coarse accounts status. Companies House does not return a single
 * "status" field for accounts, so we synthesise one from the overdue flag and
 * the presence of a next-due date.
 */
function deriveAccountsStatus(profile: CompaniesHouseRawProfile): string | null {
  const accounts = profile.accounts;
  if (!accounts) return null;
  const overdue = accounts.overdue ?? accounts.next_accounts?.overdue;
  if (overdue === true) return "overdue";
  if (accounts.next_due || accounts.next_accounts?.due_on) return "due";
  return null;
}

export function normaliseCompanyProfile(
  profile: CompaniesHouseRawProfile,
): NormalisedCompanySnapshot {
  const sicCodes = Array.isArray(profile.sic_codes)
    ? profile.sic_codes.filter((c): c is string => typeof c === "string").map((c) => c.trim())
    : [];

  return {
    companyNumber: cleanString(profile.company_number) ?? "",
    companyName: cleanString(profile.company_name),
    companyStatus: cleanString(profile.company_status),
    companyType: cleanString(profile.type),
    registeredOfficeAddress: cleanAddress(profile.registered_office_address),
    dateOfCreation: cleanString(profile.date_of_creation),
    jurisdiction: cleanString(profile.jurisdiction),
    accountsNextDue:
      cleanString(profile.accounts?.next_due) ??
      cleanString(profile.accounts?.next_accounts?.due_on),
    accountsStatus: deriveAccountsStatus(profile),
    confirmationStatementNextDue: cleanString(profile.confirmation_statement?.next_due),
    sicCodes: [...sicCodes].sort(),
  };
}
