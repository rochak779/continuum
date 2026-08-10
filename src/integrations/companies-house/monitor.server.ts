// Server-only wiring for Companies House monitoring.
//
// SECURITY: this module imports the service-role Supabase client and reads the
// Companies House API key from the environment. It must ONLY be imported from
// server contexts — a dynamic import inside a server-function handler, or from
// the local dev script. Never import it from a route/component/.functions.ts
// file, or the service-role key + API key handling would ship to the browser.

import { fetchCompanyProfile } from "./client";
import {
  runCompaniesHouseCheck,
  type AlertRecord,
  type CheckOutcome,
  type ChangeEventRecord,
  type FailureRecord,
  type MonitoringStore,
  type PersistedChangeEvent,
  type SnapshotRecord,
  type TrustProfileAttributeRecord,
} from "./monitor";
import {
  COMPANIES_HOUSE_SOURCE,
  type CompaniesHouseResult,
  type JsonValue,
} from "./types";

function getApiKey(): string {
  return process.env["COMPANIES_HOUSE_API_KEY"] ?? "";
}

// ---------------------------------------------------------------------------
// Supabase-backed store (service role, bypasses RLS). All Companies House
// table query syntax is isolated here.
// ---------------------------------------------------------------------------

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export function createSupabaseMonitoringStore(db: AdminClient): MonitoringStore {
  return {
    async getTrustProfile(vendorId) {
      const { data, error } = await db
        .from("trust_profile_attributes")
        .select("attribute_key,current_value")
        .eq("vendor_id", vendorId)
        .eq("source", COMPANIES_HOUSE_SOURCE);
      if (error) throw error;
      return Object.fromEntries(
        data.map((row) => [row.attribute_key, row.current_value as JsonValue]),
      );
    },

    async insertSnapshot(record: SnapshotRecord & { vendorId: string }): Promise<string> {
      const { data, error } = await db
        .from("vendor_company_snapshots")
        .insert({
          vendor_id: record.vendorId,
          source: COMPANIES_HOUSE_SOURCE,
          company_number: record.companyNumber,
          company_name: record.companyName,
          company_status: record.companyStatus,
          company_type: record.companyType,
          registered_office_address: (record.registeredOfficeAddress as unknown as null) ?? null,
          date_of_creation: record.dateOfCreation,
          jurisdiction: record.jurisdiction,
          accounts_next_due: record.accountsNextDue,
          accounts_status: record.accountsStatus,
          confirmation_statement_next_due: record.confirmationStatementNextDue,
          sic_codes: record.sicCodes,
          raw_response: record.rawResponse as never,
          checked_at: record.checkedAt,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },

    async createTrustBaseline(records: TrustProfileAttributeRecord[]): Promise<void> {
      if (records.length === 0) return;
      const { error } = await db.from("trust_profile_attributes").upsert(
        records.map((record) => ({
          vendor_id: record.vendorId,
          attribute_key: record.attributeKey,
          current_value: record.currentValue as never,
          source: record.source,
          confidence: "provider_reported",
          verified_at: record.verifiedAt,
        })),
        { onConflict: "vendor_id,attribute_key", ignoreDuplicates: true },
      );
      if (error) throw error;
    },

    async insertChangeEvents(
      records: ChangeEventRecord[],
    ): Promise<{ inserted: number; events: PersistedChangeEvent[] }> {
      if (records.length === 0) return { inserted: 0, events: [] };
      const { data: insertedRows, error } = await db
        .from("vendor_change_events")
        .upsert(
          records.map((record) => ({
            vendor_id: record.vendorId,
            snapshot_id: record.snapshotId,
            source: record.source,
            attribute_key: record.attribute,
            previous_value: record.previousValue as never,
            new_value: record.newValue as never,
            severity: record.severity,
            detected_at: record.detectedAt,
            dedupe_key: record.dedupeKey,
          })),
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      const { data: persistedRows, error: selectError } = await db
        .from("vendor_change_events")
        .select("id,dedupe_key")
        .in(
          "dedupe_key",
          records.map((record) => record.dedupeKey),
        );
      if (selectError) throw selectError;
      const idsByKey = new Map(persistedRows.map((row) => [row.dedupe_key, row.id]));
      return {
        inserted: insertedRows?.length ?? 0,
        events: records.flatMap((record) => {
          const id = idsByKey.get(record.dedupeKey);
          return id ? [{ ...record, id }] : [];
        }),
      };
    },

    async insertAlerts(records: AlertRecord[]): Promise<{ inserted: number }> {
      if (records.length === 0) return { inserted: 0 };
      // Idempotent on dedupe_key: existing alerts for the same detected change
      // are ignored rather than duplicated.
      const { data, error } = await db
        .from("vendor_monitoring_alerts")
        .upsert(
          records.map((r) => ({
            vendor_id: r.vendorId,
            change_event_id: r.changeEventId,
            snapshot_id: r.snapshotId,
            source: r.source,
            attribute_checked: r.attribute,
            previous_value: r.previousValue,
            new_value: r.newValue,
            severity: r.severity,
            status: "open",
            checked_at: r.checkedAt,
            dedupe_key: r.dedupeKey,
          })),
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw error;
      return { inserted: data?.length ?? 0 };
    },

    async recordFailure(record: FailureRecord): Promise<void> {
      const { error } = await db.from("vendor_monitoring_failures").insert({
        vendor_id: record.vendorId,
        company_number: record.companyNumber,
        source: record.source,
        error_type: record.errorType,
        message: record.message,
        http_status: record.httpStatus ?? null,
        checked_at: record.checkedAt,
      });
      if (error) throw error;
    },

    async setMonitoringStatus(vendorId, status): Promise<void> {
      const { error } = await db
        .from("vendors")
        .update({ monitoring_status: status })
        .eq("id", vendorId);
      if (error) throw error;
    },
  };
}

// A no-op store used for dry runs (no service-role key required). It reports no
// previous snapshot (so results read as a baseline) and persists nothing.
export function createNullStore(): MonitoringStore {
  return {
    async getTrustProfile() {
      return {};
    },
    async insertSnapshot() {
      return "dry-run-snapshot";
    },
    async createTrustBaseline() {
      /* dry run: nothing persisted */
    },
    async insertChangeEvents() {
      return { inserted: 0, events: [] };
    },
    async insertAlerts() {
      return { inserted: 0 };
    },
    async recordFailure() {
      /* dry run: nothing persisted */
    },
    async setMonitoringStatus() {
      /* dry run: nothing persisted */
    },
  };
}

export interface RunVendorCheckOptions {
  persist?: boolean | undefined;
  apiKey?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Entry point for a single vendor check from server contexts (server function
 * handler or the local dev script).
 */
export async function runVendorCompaniesHouseCheck(
  vendorId: string,
  companyNumber: string,
  options: RunVendorCheckOptions = {},
): Promise<CheckOutcome> {
  const persist = options.persist ?? true;
  const apiKey = options.apiKey ?? getApiKey();

  let store: MonitoringStore;
  if (persist) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    store = createSupabaseMonitoringStore(supabaseAdmin);
  } else {
    store = createNullStore();
  }

  const fetchProfile = (num: string): Promise<CompaniesHouseResult> =>
    fetchCompanyProfile(num, { apiKey, fetchImpl: options.fetchImpl });

  return runCompaniesHouseCheck({ vendorId, companyNumber }, { fetchProfile, store });
}
