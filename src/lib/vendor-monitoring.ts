import { runInitialBaselineChecksFn } from "@/integrations/companies-house/baseline-check";

/**
 * Kicks off an initial Companies House check for newly-created vendors,
 * without making the caller wait for it. Best-effort: a vendor that fails
 * here just stays "not_monitored" until the next scheduled sweep, rather
 * than blocking or failing vendor creation.
 */
export function triggerInitialBaselineChecks(
  createdVendors: readonly { id: string; companies_house_number: string | null }[],
): void {
  const vendorIds = createdVendors
    .filter((vendor) => !!vendor.companies_house_number)
    .map((vendor) => vendor.id);
  if (vendorIds.length === 0) return;
  runInitialBaselineChecksFn({ data: { vendorIds } }).catch((err) => {
    console.error("Failed to trigger initial vendor monitoring:", err);
  });
}
