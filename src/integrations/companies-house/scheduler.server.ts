import { runVendorCompaniesHouseCheck } from "./monitor.server";
import { runScheduledBatch, type EligibleVendor, type SchedulerStore } from "./scheduler";
import type { CheckOutcome } from "./monitor";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export function createSupabaseSchedulerStore(db: AdminClient): SchedulerStore {
  return {
    async acquireLease(token, leaseMs) {
      const { data, error } = await db.rpc("acquire_companies_house_scheduler_lease", {
        p_lease_token: token,
        p_lease_seconds: Math.ceil(leaseMs / 1_000),
      });
      if (error) throw error;
      return data;
    },

    async releaseLease(token) {
      const { error } = await db.rpc("release_companies_house_scheduler_lease", {
        p_lease_token: token,
      });
      if (error) throw error;
    },

    async getEligibleVendors(limit) {
      const { data: configs, error } = await db
        .from("vendor_monitoring_config")
        .select("vendor_id")
        .eq("provider", "companies_house")
        .eq("enabled", true)
        .lte("next_check_at", new Date().toISOString())
        .order("next_check_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      if (configs.length === 0) return [];
      const { data: vendors, error: vendorError } = await db
        .from("vendors")
        .select("id,companies_house_number")
        .in(
          "id",
          configs.map((config) => config.vendor_id),
        )
        .not("companies_house_number", "is", null);
      if (vendorError) throw vendorError;
      const byId = new Map(vendors.map((vendor) => [vendor.id, vendor.companies_house_number]));
      return configs.flatMap((config) => {
        const companyNumber = byId.get(config.vendor_id);
        return companyNumber ? [{ vendorId: config.vendor_id, companyNumber }] : [];
      });
    },

    async beginRun(vendor, trigger) {
      const { data, error } = await db
        .from("vendor_monitoring_runs")
        .insert({
          vendor_id: vendor.vendorId,
          provider: "companies_house",
          trigger_type: trigger,
          status: "running",
        })
        .select("id")
        .single();
      if (error?.code === "23505") return null;
      if (error) throw error;
      return data.id;
    },

    async finishRun(runId, outcome) {
      const failure = outcome instanceof Error || outcome.status === "failed";
      const errorType =
        outcome instanceof Error
          ? "unexpected_error"
          : outcome.status === "failed"
            ? outcome.errorType
            : null;
      const errorMessage =
        outcome instanceof Error
          ? outcome.message
          : outcome.status === "failed"
            ? outcome.message
            : null;
      const { error } = await db
        .from("vendor_monitoring_runs")
        .update({
          status: failure ? "failed" : "success",
          completed_at: new Date().toISOString(),
          error_type: errorType,
          error_message: errorMessage,
        })
        .eq("id", runId);
      if (error) throw error;
    },

    async markChecked(vendorId, checkedAt) {
      const nextCheck = new Date(new Date(checkedAt).getTime() + 24 * 60 * 60_000).toISOString();
      const { error } = await db
        .from("vendor_monitoring_config")
        .update({ last_checked_at: checkedAt, next_check_at: nextCheck })
        .eq("vendor_id", vendorId)
        .eq("provider", "companies_house");
      if (error) throw error;
    },
  };
}

export async function runScheduledCompaniesHouseMonitoring(): Promise<
  Awaited<ReturnType<typeof runScheduledBatch>>
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const store = createSupabaseSchedulerStore(supabaseAdmin);
  const runCheck = (vendor: EligibleVendor): Promise<CheckOutcome> =>
    runVendorCompaniesHouseCheck(vendor.vendorId, vendor.companyNumber, { persist: true });
  return runScheduledBatch({ store, runCheck });
}
