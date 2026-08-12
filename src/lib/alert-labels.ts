// Shared display helpers for Companies House monitoring alerts
// (vendor_monitoring_alerts / vendor_change_events). Used by the dashboard's
// alert panels and by the Alerts tab (src/routes/_authenticated/alerts/*) so
// both surfaces describe the same `attribute_checked` / `attribute_key`
// vocabulary the same way.

export const ALERT_ATTRIBUTE_LABELS: Record<string, string> = {
  company_status: "Company Status",
  company_name: "Company Name",
  registered_address: "Address",
  sic_codes: "SIC Codes",
  accounts_status: "Accounts Filing",
  confirmation_statement_status: "Confirmation Statement",
};

export function alertAttributeLabel(attributeKey: string): string {
  return ALERT_ATTRIBUTE_LABELS[attributeKey] ?? attributeKey;
}

/** One-line summary of what changed, e.g. "Company Status changed from active to dissolved." */
export function describeAlertReason(alert: {
  attribute_checked: string;
  previous_value: string | null;
  new_value: string | null;
}): string {
  const label = alertAttributeLabel(alert.attribute_checked);
  const previous = alert.previous_value ?? "unset";
  const next = alert.new_value ?? "unset";
  return `${label} changed from ${previous} to ${next}.`;
}
