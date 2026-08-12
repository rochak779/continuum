// Pure builder for the critical-alert digest email. No Node/Supabase/Resend
// imports here — see ./notify-critical-alerts.server.ts for the wiring that
// calls this and actually sends the result.
//
// Reuses src/lib/alert-labels.ts's alertAttributeLabel/describeAlertReason
// so the email describes a change with the exact same wording the Alerts UI
// already uses.

import { alertAttributeLabel, describeAlertReason } from "@/lib/alert-labels";

export interface CriticalAlertEmailItem {
  id: string;
  attribute: string;
  previousValue: string | null;
  newValue: string | null;
}

export interface CriticalAlertEmailInput {
  vendorName: string;
  siteUrl: string;
  alerts: CriticalAlertEmailItem[];
}

export interface CriticalAlertEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCriticalAlertEmail(input: CriticalAlertEmailInput): CriticalAlertEmail {
  const { vendorName, siteUrl, alerts } = input;

  const subject =
    alerts.length === 1
      ? `Critical alert: ${vendorName} — ${alertAttributeLabel(alerts[0]!.attribute)}`
      : `${alerts.length} critical alerts: ${vendorName}`;

  const items = alerts.map((alert) => ({
    reason: describeAlertReason({
      attribute_checked: alert.attribute,
      previous_value: alert.previousValue,
      new_value: alert.newValue,
    }),
    link: `${siteUrl}/alerts/${alert.id}`,
  }));

  const intro =
    alerts.length === 1
      ? `${vendorName} has a new critical alert:`
      : `${vendorName} has ${alerts.length} new critical alerts:`;

  const text = [intro, "", ...items.map(({ reason, link }) => `- ${reason}\n  ${link}`)].join("\n");

  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    "<ul>",
    ...items.map(
      ({ reason, link }) =>
        `<li>${escapeHtml(reason)} <a href="${escapeHtml(link)}">View alert</a></li>`,
    ),
    "</ul>",
  ].join("\n");

  return { subject, html, text };
}
