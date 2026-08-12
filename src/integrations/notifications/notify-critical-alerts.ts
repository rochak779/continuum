// Pure orchestrator: given a vendor and its newly-inserted critical alerts,
// resolve the recipient, build the email, and send it — all through
// injected deps, so this has no Node/Supabase/Resend imports of its own.
// See ./notify-critical-alerts.server.ts for the deps built from the real
// Supabase admin client + Resend sender.
//
// MUST NOT throw: every dependency call is wrapped so a failure anywhere in
// this path (vendor lookup, email lookup, send) is logged and swallowed,
// never propagated to the monitoring pipeline that calls this.

import { buildCriticalAlertEmail, type CriticalAlertEmailItem } from "./build-critical-alert-email";

export type CriticalAlertItem = CriticalAlertEmailItem;

export interface VendorInfo {
  companyName: string;
  ownerId: string;
}

export interface NotifyCriticalAlertsDeps {
  getVendor(vendorId: string): Promise<VendorInfo | null>;
  getOwnerEmail(ownerId: string): Promise<string | null>;
  sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ ok: boolean; message?: string | undefined }>;
  siteUrl: string;
}

export async function notifyCriticalAlerts(
  input: { vendorId: string; alerts: CriticalAlertItem[] },
  deps: NotifyCriticalAlertsDeps,
): Promise<void> {
  if (input.alerts.length === 0) return;

  try {
    const vendor = await deps.getVendor(input.vendorId);
    if (!vendor) {
      console.error("[notifications] vendor not found, skipping critical alert email", {
        vendorId: input.vendorId,
      });
      return;
    }

    const email = await deps.getOwnerEmail(vendor.ownerId);
    if (!email) {
      console.error("[notifications] owner has no email on file, skipping critical alert email", {
        vendorId: input.vendorId,
        ownerId: vendor.ownerId,
      });
      return;
    }

    const message = buildCriticalAlertEmail({
      vendorName: vendor.companyName,
      siteUrl: deps.siteUrl,
      alerts: input.alerts,
    });

    const result = await deps.sendEmail({ to: email, ...message });
    if (!result.ok) {
      console.error("[notifications] failed to send critical alert email", {
        vendorId: input.vendorId,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("[notifications] unexpected error sending critical alert email", {
      vendorId: input.vendorId,
      error,
    });
  }
}
