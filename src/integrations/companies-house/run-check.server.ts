// Server-only wiring for a single Companies House monitoring check, on the
// new provider-agnostic pipeline:
//
//   vendor -> vendor_identifiers (COMPANIES_HOUSE_NUMBER) -> provider
//          -> normalized response -> external_snapshots -> monitoring_runs
//
// This is the app-facing entry point (server function handler, or the local
// dev script). It must ONLY be imported from server contexts — it reads the
// service-role Supabase client and the Companies House API key.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createCompaniesHouseProvider } from "./provider.server";
import { createSupabaseMonitoringRunStore } from "../monitoring/snapshot-pipeline.server";
import {
  runSnapshotPipeline,
  type SnapshotPipelineOutcome,
  type TriggerType,
} from "../monitoring/snapshot-pipeline";

const COMPANIES_HOUSE_IDENTIFIER_TYPE = "COMPANIES_HOUSE_NUMBER";

// Untyped on purpose: `vendor_identifiers` isn't in the generated Database
// type yet — see snapshot-pipeline.server.ts's file header.
type AdminClient = SupabaseClient;

export type RunVendorCheckOutcome = SnapshotPipelineOutcome | { status: "no_identifier" };

interface VendorIdentifierRow {
  identifier_value: string;
}

/**
 * Look up this vendor's Companies House number: prefer the primary
 * identifier of this type, fall back to the most recently created one if no
 * identifier has been marked primary yet.
 */
async function getCompaniesHouseIdentifier(
  db: AdminClient,
  vendorId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("vendor_identifiers")
    .select("identifier_value")
    .eq("vendor_id", vendorId)
    .eq("identifier_type", COMPANIES_HOUSE_IDENTIFIER_TYPE)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as VendorIdentifierRow | null)?.identifier_value ?? null;
}

export interface RunVendorCheckOptions {
  triggerType?: TriggerType | undefined;
}

/**
 * Run one Companies House check for a vendor, end to end: look up its
 * Companies House number, fetch + normalize via the provider, and persist
 * an external_snapshots + monitoring_runs row through the shared pipeline.
 * A provider failure yields a `status: "failed"` monitoring run; vendor
 * rows are never touched by this function (see ../monitoring/snapshot-pipeline).
 */
export async function runVendorCompaniesHouseCheck(
  vendorId: string,
  options: RunVendorCheckOptions = {},
): Promise<RunVendorCheckOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const identifierValue = await getCompaniesHouseIdentifier(supabaseAdmin, vendorId);
  if (!identifierValue) {
    return { status: "no_identifier" };
  }

  const store = createSupabaseMonitoringRunStore(supabaseAdmin);
  const provider = createCompaniesHouseProvider();

  return runSnapshotPipeline(store, {
    vendorId,
    provider,
    identifierValue,
    triggerType: options.triggerType ?? "manual",
  });
}
