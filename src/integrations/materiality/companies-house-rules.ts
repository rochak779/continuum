// Companies House materiality rule set (ERD §21 "Initial Version").
// Deterministic only — no AI/LLM involved, by requirement.
//
// Each rule below implements one of the ERD's three example buckets:
//
//   Critical      -> company_status moves into a non-operational state
//   Attention     -> company name / registered office / SIC classification
//                    changed, or company_status changed to some other status
//   Informational -> everything else (handled by the engine's fallback rule,
//                    not repeated here — ERD §21 just says "non-risk
//                    metadata changes", it doesn't enumerate every field)
//
// Attribute keys match the ones produced by
// ../companies-house/detect-changes.ts (company_status, company_name,
// registered_office_address, sic_codes, ...).

import type { MaterialityInput, MaterialityResult, MaterialityRule } from "./types";

export const COMPANIES_HOUSE_PROVIDER = "companies_house";

// Company statuses that indicate the company may no longer safely operate.
// Source: Companies House `company_status` enumeration (ERD §21's "other
// clearly non-operational company states").
const RISK_STATUSES = new Set<string>([
  "dissolved",
  "liquidation",
  "administration",
  "receivership",
  "receiver-action",
  "insolvency-proceedings",
  "voluntary-arrangement",
  "converted-closed",
  "closed",
  "removed",
]);

export function isRiskCompanyStatus(status: unknown): boolean {
  return typeof status === "string" && RISK_STATUSES.has(status.toLowerCase());
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return "unset";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isCompaniesHouse(input: MaterialityInput): boolean {
  return input.provider === COMPANIES_HOUSE_PROVIDER;
}

/** Active/whatever -> Dissolved/Liquidation/Administration/... — ERD §21 Critical, verbatim example. */
const companyStatusBecomesNonOperational: MaterialityRule = {
  id: "companies_house.company_status.non_operational",
  appliesTo: (input) =>
    isCompaniesHouse(input) &&
    input.attributeKey === "company_status" &&
    isRiskCompanyStatus(input.newValue),
  classify: (input): MaterialityResult => ({
    severity: "critical",
    explanation: `Company status changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction:
      "Review the vendor relationship and any pending financial or operational commitments immediately.",
    ruleId: "companies_house.company_status.non_operational",
  }),
};

/** Any other company_status transition (e.g. one benign status to another, or recovering out of a risk status). */
const companyStatusOtherChange: MaterialityRule = {
  id: "companies_house.company_status.other",
  appliesTo: (input) => isCompaniesHouse(input) && input.attributeKey === "company_status",
  classify: (input): MaterialityResult => ({
    severity: "attention",
    explanation: `Company status changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction:
      "Review the status change to confirm it does not affect the vendor relationship.",
    ruleId: "companies_house.company_status.other",
  }),
};

/** ERD §21 Attention: "Company name changed". */
const companyNameChanged: MaterialityRule = {
  id: "companies_house.company_name.changed",
  appliesTo: (input) => isCompaniesHouse(input) && input.attributeKey === "company_name",
  classify: (input): MaterialityResult => ({
    severity: "attention",
    explanation: `Company name changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction:
      "Confirm the name change is legitimate (e.g. rebrand or merger) and update internal vendor records accordingly.",
    ruleId: "companies_house.company_name.changed",
  }),
};

/** ERD §21 Attention: "Registered office changed". */
const registeredOfficeChanged: MaterialityRule = {
  id: "companies_house.registered_office_address.changed",
  appliesTo: (input) =>
    isCompaniesHouse(input) && input.attributeKey === "registered_office_address",
  classify: (input): MaterialityResult => ({
    severity: "attention",
    explanation: `Registered office address changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction:
      "Verify the new registered address with the vendor and update internal records accordingly.",
    ruleId: "companies_house.registered_office_address.changed",
  }),
};

/** ERD §21 Attention: "Material SIC classification change". */
const sicCodesChanged: MaterialityRule = {
  id: "companies_house.sic_codes.changed",
  appliesTo: (input) => isCompaniesHouse(input) && input.attributeKey === "sic_codes",
  classify: (input): MaterialityResult => ({
    severity: "attention",
    explanation: `SIC classification changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction:
      "Review the updated SIC classification to confirm it still matches the vendor's expected business activity for this engagement.",
    ruleId: "companies_house.sic_codes.changed",
  }),
};

/**
 * Ordered rule set for the Companies House provider. `company_status`'s
 * "becomes non-operational" rule must come before its own catch-all so a
 * risky transition is never mis-classified as merely "attention". The
 * engine's FALLBACK_RULE (ERD §21 Informational) handles every attribute
 * key not covered here — company_type, jurisdiction, accounts_next_due,
 * confirmation_statement_next_due, etc.
 */
export const COMPANIES_HOUSE_MATERIALITY_RULES: readonly MaterialityRule[] = [
  companyStatusBecomesNonOperational,
  companyStatusOtherChange,
  companyNameChanged,
  registeredOfficeChanged,
  sicCodesChanged,
];
