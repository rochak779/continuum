#!/usr/bin/env bun
/**
 * Manually trigger one Companies House monitoring check locally.
 *
 * Usage:
 *   bun run monitor:check <companyNumber> [--vendor <vendorId>] [--persist]
 *
 * Examples:
 *   # Dry run (default): fetches from the real Companies House API, prints
 *   # the normalised snapshot. Writes NOTHING — no monitoring_runs or
 *   # external_snapshots row, no Supabase credentials needed.
 *   bun run monitor:check 00000006
 *
 *   # Persist: runs the full pipeline (monitoring_runs + external_snapshots)
 *   # for a real vendor. Requires SUPABASE_SERVICE_ROLE_KEY and a vendor
 *   # UUID that already exists.
 *   bun run monitor:check 00000006 --vendor <vendor-uuid> --persist
 *
 * A failed fetch (bad API key, company not found, upstream error, ...) never
 * throws here: with --persist it is recorded as a failed monitoring_runs
 * row and the vendor is left untouched; without --persist it is just
 * printed.
 *
 * Env (loaded automatically by Bun from .env):
 *   COMPANIES_HOUSE_API_KEY                   required
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required only with --persist
 */

import { createCompaniesHouseProvider } from "@/integrations/companies-house/provider.server";
import { fetchNormalizedSnapshot } from "@/integrations/monitoring/run-provider-fetch";
import { runSnapshotPipeline } from "@/integrations/monitoring/snapshot-pipeline";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const persist = args.includes("--persist");
const vendorFlagIndex = args.indexOf("--vendor");
const vendorId = vendorFlagIndex >= 0 ? args[vendorFlagIndex + 1] : undefined;
const positional = args.filter((a, i) => !a.startsWith("--") && i !== vendorFlagIndex + 1);
const companyNumber = positional[0];

if (!companyNumber) {
  fail("Provide a company number, e.g. `bun run monitor:check 00000006`");
}

if (!process.env["COMPANIES_HOUSE_API_KEY"]) {
  fail("COMPANIES_HOUSE_API_KEY is not set. Add it to your .env file.");
}

if (persist) {
  if (!vendorId) {
    fail("--persist requires --vendor <vendor-uuid> (a vendor that already exists).");
  }
  if (!process.env["SUPABASE_SERVICE_ROLE_KEY"] || !process.env["SUPABASE_URL"]) {
    fail("--persist requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.");
  }
}

console.log(
  `\n▶ Companies House check for company ${companyNumber}` +
    (persist ? ` (vendor ${vendorId}, PERSISTING)` : " (dry run — nothing will be written)"),
);

const provider = createCompaniesHouseProvider();

if (!persist) {
  const result = await fetchNormalizedSnapshot(provider, companyNumber);
  if (!result.ok) {
    console.error(`\n✖ Check failed [${result.error.type}]: ${result.error.message}\n`);
    process.exit(2);
  }
  console.log("\n── Normalised snapshot ──────────────────────────────");
  console.dir(result.snapshot, { depth: null });
  console.log("\n✔ Done. Dry run — nothing persisted.\n");
  process.exit(0);
}

const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
const { createSupabaseMonitoringRunStore } =
  await import("@/integrations/monitoring/snapshot-pipeline.server");
const store = createSupabaseMonitoringRunStore(supabaseAdmin);

// vendorId is guaranteed set above when persist is true.
const { data: vendorRow, error: vendorError } = await supabaseAdmin
  .from("vendors")
  .select("organisation_id")
  .eq("id", vendorId as string)
  .maybeSingle();
if (vendorError) fail(`Failed to look up vendor ${vendorId}: ${vendorError.message}`);
if (!vendorRow) fail(`Vendor ${vendorId} does not exist.`);
const organisationId = (vendorRow as { organisation_id: string }).organisation_id;

const outcome = await runSnapshotPipeline(store, {
  organisationId,
  vendorId: vendorId as string,
  provider,
  identifierValue: companyNumber,
  triggerType: "manual",
  actor: { id: null, type: "system" },
});

if (outcome.status === "skipped") {
  console.log(`\n… Skipped: ${outcome.reason}. A check is already running for this vendor.\n`);
  process.exit(0);
}

if (outcome.status === "failed") {
  console.error(`\n✖ Check failed [${outcome.error.type}]: ${outcome.error.message}`);
  console.error(
    `  monitoring_runs row ${outcome.runId} recorded as failed. Vendor data unchanged.\n`,
  );
  process.exit(2);
}

console.log("\n── Normalised snapshot ──────────────────────────────");
console.dir(outcome.snapshot, { depth: null });
console.log(
  `\n✔ Done. monitoring_runs row ${outcome.runId} succeeded; ` +
    `external_snapshots row ${outcome.snapshotId} persisted.\n`,
);
