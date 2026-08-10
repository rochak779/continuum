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
  type FailureRecord,
  type MonitoringStore,
  type SnapshotRecord,
  type TrustProfileAttributeRecord,
} from "./monitor";
import {
  COMPANIES_HOUSE_SOURCE,
  type CompaniesHouseAddress,
  type CompaniesHouseResult,
  type NormalisedCompanySnapshot,
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
    async getLatestSnapshot(vendorId): Promise<NormalisedCompanySnapshot | null> {
      const { data, error } = await db
        .from("vendor_company_snapshots")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        companyNumber: data.company_number,
        companyName: data.company_name,
        companyStatus: data.company_status,
        companyType: data.company_type,
        registeredOfficeAddress:
          (data.registered_office_address as CompaniesHouseAddress | null) ?? null,
        dateOfCreation: data.date_of_creation,
        jurisdiction: data.jurisdiction,
        accountsNextDue: data.accounts_next_due,
        accountsStatus: data.accounts_status,
        confirmationStatementNextDue: data.confirmation_statement_next_due,
        sicCodes: data.sic_codes ?? [],
      };
    },

    async insertSnapshot(record: SnapshotRecord & { vendorId: string }): Promise<void> {
      const { error } = await db.from("vendor_company_snapshots").insert({
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
      });
      if (error) throw error;
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

    async insertAlerts(records: AlertRecord[]): Promise<{ inserted: number }> {
      if (records.length === 0) return { inserted: 0 };
      // Idempotent on dedupe_key: existing alerts for the same detected change
      // are ignored rather than duplicated.
      const { data, error } = await db
        .from("vendor_monitoring_alerts")
        .upsert(
          records.map((r) => ({
            vendor_id: r.vendorId,
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
  };
}

// A no-op store used for dry runs (no service-role key required). It reports no
// previous snapshot (so results read as a baseline) and persists nothing.
export function createNullStore(): MonitoringStore {
  return {
    async getLatestSnapshot() {
      return null;
    },
    async insertSnapshot() {
      /* dry run: nothing persisted */
    },
    async createTrustBaseline() {
      /* dry run: nothing persisted */
    },
    async insertAlerts() {
      return { inserted: 0 };
    },
    async recordFailure() {
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
