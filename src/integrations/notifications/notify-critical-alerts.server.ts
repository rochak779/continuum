// Server-only wiring: builds notify-critical-alerts.ts's deps from the
// Supabase service-role client (vendors table + auth.admin) and Resend
// (send-critical-alert-email.server.ts). Must ONLY be imported from server
// contexts, same rule as companies-house/monitor.server.ts.

import { notifyCriticalAlerts, type CriticalAlertItem } from "./notify-critical-alerts";
import { sendCriticalAlertEmail } from "./send-critical-alert-email.server";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/**
 * Vercel provides VERCEL_PROJECT_PRODUCTION_URL (no protocol, stable across
 * deploys) automatically — no setup required. Falls back to localhost for
 * local dev, where that env var isn't set.
 */
function resolveSiteUrl(): string {
  const productionUrl = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  return productionUrl ? `https://${productionUrl}` : "http://localhost:8080";
}

export async function notifyCriticalAlertsForVendor(
  db: AdminClient,
  vendorId: string,
  alerts: CriticalAlertItem[],
): Promise<void> {
  await notifyCriticalAlerts(
    { vendorId, alerts },
    {
      async getVendor(id) {
        const { data, error } = await db
          .from("vendors")
          .select("company_name,owner_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ? { companyName: data.company_name, ownerId: data.owner_id } : null;
      },
      async getOwnerEmail(ownerId) {
        const { data, error } = await db.auth.admin.getUserById(ownerId);
        if (error) throw error;
        return data.user?.email ?? null;
      },
      sendEmail: (input) => sendCriticalAlertEmail(input),
      siteUrl: resolveSiteUrl(),
    },
  );
}
