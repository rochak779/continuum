// Pure orchestration for a single Companies House check.
//
// This module intentionally imports NO Supabase / Node runtime. It talks to
// storage through the `MonitoringStore` interface, so it can be unit tested
// end-to-end with an in-memory fake (see monitor.test.ts) covering the full
// flow: API response -> snapshot -> comparison -> alert / failure.

import { detectChanges, buildAlertDedupeKey } from "./detect-changes";
import { normaliseCompanyProfile } from "./normalize";
import {
  COMPANIES_HOUSE_SOURCE,
  type CompaniesHouseResult,
  type DetectedChange,
  type NormalisedCompanySnapshot,
} from "./types";

export interface SnapshotRecord extends NormalisedCompanySnapshot {
  rawResponse: unknown;
  checkedAt: string;
}

export interface AlertRecord {
  vendorId: string;
  source: string;
  attribute: string;
  previousValue: string | null;
  newValue: string | null;
  severity: DetectedChange["severity"];
  checkedAt: string;
  dedupeKey: string;
}

export interface FailureRecord {
  vendorId: string;
  companyNumber: string;
  source: string;
  errorType: string;
  message: string;
  httpStatus?: number | undefined;
  checkedAt: string;
}

export interface TrustProfileAttributeRecord {
  vendorId: string;
  attributeKey: string;
  currentValue: unknown;
  source: string;
  verifiedAt: string;
}

// Storage boundary. `insertAlerts` MUST be idempotent on dedupeKey so repeated
// checks never create duplicate alerts for the same detected change.
export interface MonitoringStore {
  getLatestSnapshot(vendorId: string): Promise<NormalisedCompanySnapshot | null>;
  insertSnapshot(record: SnapshotRecord & { vendorId: string }): Promise<void>;
  createTrustBaseline(records: TrustProfileAttributeRecord[]): Promise<void>;
  insertAlerts(records: AlertRecord[]): Promise<{ inserted: number }>;
  recordFailure(record: FailureRecord): Promise<void>;
}

export function buildTrustBaseline(
  vendorId: string,
  snapshot: NormalisedCompanySnapshot,
  verifiedAt: string,
): TrustProfileAttributeRecord[] {
  const values: Record<string, unknown> = {
    company_number: snapshot.companyNumber,
    company_name: snapshot.companyName,
    company_status: snapshot.companyStatus,
    company_type: snapshot.companyType,
    registered_office_address: snapshot.registeredOfficeAddress,
    date_of_creation: snapshot.dateOfCreation,
    jurisdiction: snapshot.jurisdiction,
    accounts_next_due: snapshot.accountsNextDue,
    accounts_status: snapshot.accountsStatus,
    confirmation_statement_next_due: snapshot.confirmationStatementNextDue,
    sic_codes: snapshot.sicCodes,
  };

  return Object.entries(values)
    .filter(([, value]) => value !== null && value !== "")
    .map(([attributeKey, currentValue]) => ({
      vendorId,
      attributeKey,
      currentValue,
      source: COMPANIES_HOUSE_SOURCE,
      verifiedAt,
    }));
}

export interface RunCheckParams {
  vendorId: string;
  companyNumber: string;
}

export interface RunCheckDeps {
  fetchProfile: (companyNumber: string) => Promise<CompaniesHouseResult>;
  store: MonitoringStore;
  now?: () => Date;
}

export type CheckOutcome =
  | {
      status: "ok";
      snapshot: NormalisedCompanySnapshot;
      changes: DetectedChange[];
      alertsCreated: number;
      isBaseline: boolean;
    }
  | {
      status: "failed";
      errorType: string;
      message: string;
      httpStatus?: number | undefined;
    };

/**
 * Run one monitoring check for a vendor. Never throws for expected API failure
 * modes — those are recorded as monitoring failures and returned as a failed
 * outcome, which deliberately does NOT write a snapshot or alter vendor data.
 */
export async function runCompaniesHouseCheck(
  params: RunCheckParams,
  deps: RunCheckDeps,
): Promise<CheckOutcome> {
  const { vendorId, companyNumber } = params;
  const { fetchProfile, store } = deps;
  const now = deps.now ?? (() => new Date());
  const checkedAt = now().toISOString();

  const result = await fetchProfile(companyNumber);

  if (!result.ok) {
    // A failed API check is recorded separately and must not look like a real
    // company change.
    await store.recordFailure({
      vendorId,
      companyNumber,
      source: COMPANIES_HOUSE_SOURCE,
      errorType: result.errorType,
      message: result.message,
      httpStatus: result.httpStatus,
      checkedAt,
    });
    return {
      status: "failed",
      errorType: result.errorType,
      message: result.message,
      httpStatus: result.httpStatus,
    };
  }

  const snapshot = normaliseCompanyProfile(result.data);

  // Compare against the last stored snapshot BEFORE persisting the new one.
  const previous = await store.getLatestSnapshot(vendorId);
  const changes = detectChanges(previous, snapshot);
  const isBaseline = previous === null;

  // Preserve the new observation (append-only; never overwrites history).
  await store.insertSnapshot({
    ...snapshot,
    vendorId,
    rawResponse: result.data,
    checkedAt,
  });

  if (isBaseline) {
    await store.createTrustBaseline(buildTrustBaseline(vendorId, snapshot, checkedAt));
  }

  let alertsCreated = 0;
  if (!isBaseline && changes.length > 0) {
    const alertRecords: AlertRecord[] = changes.map((change) => ({
      vendorId,
      source: COMPANIES_HOUSE_SOURCE,
      attribute: change.attribute,
      previousValue: change.previousValue,
      newValue: change.newValue,
      severity: change.severity,
      checkedAt,
      dedupeKey: buildAlertDedupeKey(vendorId, COMPANIES_HOUSE_SOURCE, change),
    }));
    const { inserted } = await store.insertAlerts(alertRecords);
    alertsCreated = inserted;
  }

  return { status: "ok", snapshot, changes, alertsCreated, isBaseline };
}
