import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { AlertResolutionStore } from "./resolution";

export function createSupabaseAlertResolutionStore(
  db: SupabaseClient<Database>,
): AlertResolutionStore {
  return {
    async verifyAlert(alertId) {
      const { data, error } = await db.rpc("verify_vendor_monitoring_alert", {
        p_alert_id: alertId,
      });
      if (error) throw error;
      return data;
    },
  };
}
