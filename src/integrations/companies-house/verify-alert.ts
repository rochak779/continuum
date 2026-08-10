import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifyMonitoringAlert } from "./resolution";
import { createSupabaseAlertResolutionStore } from "./resolution.server";

function validateInput(input: { alertId: string }) {
  if (!input || typeof input.alertId !== "string" || !input.alertId) {
    throw new Error("alertId is required");
  }
  return input;
}

export const verifyMonitoringAlertFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }) => {
    const store = createSupabaseAlertResolutionStore(context.supabase);
    await verifyMonitoringAlert({ alertId: data.alertId, actorId: context.userId }, store);
    return { verified: true };
  });
