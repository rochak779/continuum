// Compare two normalised snapshots and produce a list of meaningful changes,
// each tagged with a severity. Pure function — the heart of the monitoring
// logic and the most important thing to keep well tested.

import type {
  CompaniesHouseAddress,
  DetectedChange,
  NormalisedCompanySnapshot,
  Severity,
} from "./types";

// Company statuses that indicate the company may no longer safely operate.
// Anything here, when it becomes the *new* status, is a critical change.
// Source: Companies House `company_status` enumeration.
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

function isRiskStatus(status: string | null): boolean {
  return status != null && RISK_STATUSES.has(status.toLowerCase());
}

// Stable, human-readable single-line representation of an address so we can
// both compare and store previous/new values as text.
export function formatAddress(address: CompaniesHouseAddress | null): string | null {
  if (!address) return null;
  const parts = [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function sicToText(sicCodes: string[]): string | null {
  return sicCodes.length > 0 ? [...sicCodes].sort().join(", ") : null;
}

function statusChangeSeverity(previous: string | null, next: string | null): Severity {
  // Moving into a risk status is critical. Any other status change is
  // "attention" (e.g. from one benign status to another).
  if (isRiskStatus(next) && !isRiskStatus(previous)) return "critical";
  return "attention";
}

/**
 * Detect changes between the previous stored snapshot and the freshly fetched
 * one. When there is no previous snapshot this is the first observation, so we
 * establish a baseline and report no changes.
 */
export function detectChanges(
  previous: NormalisedCompanySnapshot | null,
  next: NormalisedCompanySnapshot,
): DetectedChange[] {
  if (!previous) return [];

  const changes: DetectedChange[] = [];

  // Company status — the highest-signal attribute.
  if ((previous.companyStatus ?? null) !== (next.companyStatus ?? null)) {
    changes.push({
      attribute: "company_status",
      previousValue: previous.companyStatus,
      newValue: next.companyStatus,
      severity: statusChangeSeverity(previous.companyStatus, next.companyStatus),
    });
  }

  // Company name.
  if ((previous.companyName ?? null) !== (next.companyName ?? null)) {
    changes.push({
      attribute: "company_name",
      previousValue: previous.companyName,
      newValue: next.companyName,
      severity: "attention",
    });
  }

  // Registered office address.
  const prevAddress = formatAddress(previous.registeredOfficeAddress);
  const nextAddress = formatAddress(next.registeredOfficeAddress);
  if (prevAddress !== nextAddress) {
    changes.push({
      attribute: "registered_office_address",
      previousValue: prevAddress,
      newValue: nextAddress,
      severity: "attention",
    });
  }

  // SIC codes — any set difference is treated as material for now.
  const prevSic = sicToText(previous.sicCodes);
  const nextSic = sicToText(next.sicCodes);
  if (prevSic !== nextSic) {
    changes.push({
      attribute: "sic_codes",
      previousValue: prevSic,
      newValue: nextSic,
      severity: "attention",
    });
  }

  // Company type — informational.
  if ((previous.companyType ?? null) !== (next.companyType ?? null)) {
    changes.push({
      attribute: "company_type",
      previousValue: previous.companyType,
      newValue: next.companyType,
      severity: "info",
    });
  }

  // Accounts next-due date — informational movement of a deadline.
  if ((previous.accountsNextDue ?? null) !== (next.accountsNextDue ?? null)) {
    changes.push({
      attribute: "accounts_next_due",
      previousValue: previous.accountsNextDue,
      newValue: next.accountsNextDue,
      severity: "info",
    });
  }

  // Confirmation statement next-due date — informational.
  if (
    (previous.confirmationStatementNextDue ?? null) !== (next.confirmationStatementNextDue ?? null)
  ) {
    changes.push({
      attribute: "confirmation_statement_next_due",
      previousValue: previous.confirmationStatementNextDue,
      newValue: next.confirmationStatementNextDue,
      severity: "info",
    });
  }

  return changes;
}

/**
 * Deterministic key used to prevent duplicate alerts. The same transition
 * (same vendor, attribute, previous value and new value) always yields the
 * same key, which is enforced by a unique index in the database.
 */
export function buildAlertDedupeKey(
  vendorId: string,
  source: string,
  change: DetectedChange,
): string {
  return [
    vendorId,
    source,
    change.attribute,
    change.previousValue ?? "∅",
    change.newValue ?? "∅",
  ].join("|");
}
