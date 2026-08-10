#!/usr/bin/env bun
/**
 * Manually trigger a Companies House check for one company number locally.
 *
 * Usage:
 *   bun run ch:check <companyNumber> [vendorId] [--persist]
 *
 * Examples:
 *   # Dry run (default): calls the real API, prints the normalised snapshot and
 *   # any detected changes. Writes NOTHING to Supabase. No service-role key needed.
 *   bun run ch:check 00000006
 *
 *   # Persist: writes the snapshot + alerts to Supabase for a real vendor.
 *   # Requires SUPABASE_SERVICE_ROLE_KEY and a real vendor UUID.
 *   bun run ch:check 00000006 <vendor-uuid> --persist
 *
 * Env (loaded automatically by Bun from .env):
 *   COMPANIES_HOUSE_API_KEY   required
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required only with --persist
 */

import { runVendorCompaniesHouseCheck } from "@/integrations/companies-house/monitor.server";

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const persist = args.includes("--persist");
const positional = args.filter((a) => !a.startsWith("--"));
const companyNumber = positional[0];
const vendorId = positional[1] ?? "00000000-0000-0000-0000-000000000000";

if (!companyNumber) {
  fail("Provide a company number, e.g. `bun run ch:check 00000006`");
}

if (!process.env["COMPANIES_HOUSE_API_KEY"]) {
  fail("COMPANIES_HOUSE_API_KEY is not set. Add it to your .env file.");
}

if (persist && !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
  fail("--persist requires SUPABASE_SERVICE_ROLE_KEY in your .env file.");
}

console.log(
  `\n▶ Companies House check for company ${companyNumber}` +
    (persist ? ` (vendor ${vendorId}, PERSISTING)` : " (dry run — nothing will be written)"),
);

const outcome = await runVendorCompaniesHouseCheck(vendorId, companyNumber, {
  persist,
});

if (outcome.status === "failed") {
  console.error(
    `\n✖ Check failed [${outcome.errorType}]${
      outcome.httpStatus ? ` (HTTP ${outcome.httpStatus})` : ""
    }: ${outcome.message}`,
  );
  if (persist) console.error("  A monitoring-failure row was recorded. Vendor data unchanged.");
  process.exit(2);
}

console.log("\n── Normalised snapshot ──────────────────────────────");
console.dir(outcome.snapshot, { depth: null });

console.log("\n── Detected changes ─────────────────────────────────");
if (outcome.isBaseline) {
  console.log("First observation for this vendor — baseline stored, no changes to report.");
} else if (outcome.changes.length === 0) {
  console.log("No changes since the previous snapshot.");
} else {
  for (const change of outcome.changes) {
    console.log(
      `  [${change.severity.toUpperCase()}] ${change.attribute}: ` +
        `${change.previousValue ?? "∅"} → ${change.newValue ?? "∅"}`,
    );
  }
}

console.log(
  `\n✔ Done. ${
    persist ? `${outcome.alertsCreated} alert(s) created.` : "Dry run — nothing persisted."
  }\n`,
);
