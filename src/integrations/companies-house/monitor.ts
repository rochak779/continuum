// Pure orchestration for a single Companies House check.
//
// This module intentionally imports NO Supabase / Node runtime. It talks to
// storage through the `MonitoringStore` interface, so it can be unit tested
// end-to-end with an in-memory fake (see monitor.test.ts) covering the full
// flow: API response -> snapshot -> comparison -> alert / failure.

import {
  buildChangeDedupeKey,
  detectBaselineChanges,
  detectChanges,
  formatChangeValue,
  type TrustProfile,
} from "./detect-changes";
import { normaliseCompanyProfile } from "./normalize";
import {
  COMPANIES_HOUSE_SOURCE,
  type CompaniesHouseResult,
  type DetectedChange,
  type JsonValue,
  type NormalisedCompanySnapshot,
} from "./types";

export interface SnapshotRecord extends NormalisedCompanySnapshot {
  rawResponse: unknown;
  checkedAt: string;
}

export interface AlertRecord {
  vendorId: string;
  changeEventId: string;
  snapshotId: string;
  source: string;
  attribute: string;
  previousValue: string | null;
  newValue: string | null;
  severity: DetectedChange["severity"];
  checkedAt: string;
  dedupeKey: string;
}

export interface ChangeEventRecord {
  vendorId: string;
  snapshotId: string;
  source: string;
  attribute: string;
  previousValue: JsonValue;
  newValue: JsonValue;
  severity: DetectedChange["severity"];
  detectedAt: string;
  dedupeKey: string;
}

export interface PersistedChangeEvent extends ChangeEventRecord {
  id: string;
}

export interface PersistedAlert extends AlertRecord {
  id: string;
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
  currentValue: JsonValue;
  source: string;
  verifiedAt: string;
}

// Storage boundary. `insertAlerts` MUST be idempotent on dedupeKey so repeated
// checks never create duplicate alerts for the same detected change.
export interface MonitoringStore {
  getTrustProfile(vendorId: string): Promise<TrustProfile>;
  insertSnapshot(record: SnapshotRecord & { vendorId: string }): Promise<string>;
  createTrustBaseline(records: TrustProfileAttributeRecord[]): Promise<void>;
  insertChangeEvents(
    records: ChangeEventRecord[],
  ): Promise<{ inserted: number; events: PersistedChangeEvent[] }>;
  insertAlerts(records: AlertRecord[]): Promise<{ inserted: PersistedAlert[] }>;
  /**
   * Best-effort side channel: send an email to the vendor's owner about
   * newly-inserted critical alerts. MUST NOT throw — implementations are
   * responsible for catching and logging their own failures (missing
   * owner email, provider error, etc.) so a notification failure can never
   * regress the monitoring pipeline itself, the same isolation guarantee
   * this interface already gives failed provider fetches.
   */
  notifyCriticalAlerts(records: PersistedAlert[]): Promise<void>;
  recordFailure(record: FailureRecord): Promise<void>;
  setMonitoringStatus(vendorId: string, status: "monitoring" | "failing"): Promise<void>;
}

export function buildActionableAlerts(events: PersistedChangeEvent[]): AlertRecord[] {
  return events
    .filter((event) => event.severity === "critical" || event.severity === "attention")
    .map((event) => ({
      vendorId: event.vendorId,
      changeEventId: event.id,
      snapshotId: event.snapshotId,
      source: event.source,
      attribute: event.attribute,
      previousValue: formatChangeValue(event.previousValue),
      newValue: formatChangeValue(event.newValue),
      severity: event.severity,
      checkedAt: event.detectedAt,
      dedupeKey: event.dedupeKey,
    }));
}

export function buildTrustBaseline(
  vendorId: string,
  snapshot: NormalisedCompanySnapshot,
  verifiedAt: string,
): TrustProfileAttributeRecord[] {
  const values: Record<string, JsonValue> = {
    company_number: snapshot.companyNumber,
    company_name: snapshot.companyName,
    company_status: snapshot.companyStatus,
    company_type: snapshot.companyType,
    registered_address: snapshot.registeredOfficeAddress
      ? Object.fromEntries(
          Object.entries(snapshot.registeredOfficeAddress).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : null,
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
      eventsCreated: number;
      isBaseline: boolean;
    }
  | {
      status: "failed";
      errorType: string;
      message: string;
      httpStatus?: number | undefined;
      retryAfterSeconds?: number | undefined;
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
    await store.setMonitoringStatus(vendorId, "failing");
    return {
      status: "failed",
      errorType: result.errorType,
      message: result.message,
      httpStatus: result.httpStatus,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  const snapshot = normaliseCompanyProfile(result.data);

  const trustProfile = await store.getTrustProfile(vendorId);
  const isBaseline = Object.keys(trustProfile).length === 0;
  const changes = isBaseline ? detectBaselineChanges(snapshot) : detectChanges(trustProfile, snapshot);

  // Preserve the new observation (append-only; never overwrites history).
  const snapshotId = await store.insertSnapshot({
    ...snapshot,
    vendorId,
    rawResponse: result.data,
    checkedAt,
  });

  if (isBaseline) {
    await store.createTrustBaseline(buildTrustBaseline(vendorId, snapshot, checkedAt));
  }

  let alertsCreated = 0;
  let eventsCreated = 0;
  if (changes.length > 0) {
    const eventRecords: ChangeEventRecord[] = changes.map((change) => ({
      vendorId,
      snapshotId,
      source: COMPANIES_HOUSE_SOURCE,
      attribute: change.attribute,
      previousValue: change.previousValue,
      newValue: change.newValue,
      severity: change.severity,
      detectedAt: checkedAt,
      dedupeKey: buildChangeDedupeKey(vendorId, COMPANIES_HOUSE_SOURCE, change),
    }));
    const persisted = await store.insertChangeEvents(eventRecords);
    eventsCreated = persisted.inserted;

    const alertRecords = buildActionableAlerts(persisted.events);
    const { inserted } = await store.insertAlerts(alertRecords);
    alertsCreated = inserted.length;

    const criticalAlerts = inserted.filter((alert) => alert.severity === "critical");
    if (criticalAlerts.length > 0) {
      await store.notifyCriticalAlerts(criticalAlerts);
    }
  }

  await store.setMonitoringStatus(vendorId, "monitoring");

  return { status: "ok", snapshot, changes, alertsCreated, eventsCreated, isBaseline };
}
