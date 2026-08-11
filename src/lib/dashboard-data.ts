import {
  calculateVendorHealth,
  type HealthAlert,
  type MonitoringStatus,
  type VendorHealth,
} from "./vendor-health";

export interface DashboardVendor {
  id: string;
  monitoring_status: string;
}

export interface DashboardAlert extends HealthAlert {
  id: string;
  vendor_id: string;
}

export interface DashboardSummary {
  totalVendors: number;
  openAlerts: number;
  attentionAlerts: number;
  healthByVendor: Map<string, VendorHealth>;
  healthCounts: Record<VendorHealth, number>;
}

export interface DashboardFailure {
  vendor_id: string;
  error_type: string;
  message: string | null;
  checked_at: string;
}

/**
 * Reduces a list of monitoring failure rows (which may include multiple
 * historical failures per vendor, in any order) to the single most recent
 * failure per vendor.
 */
export function latestFailureByVendor(
  failures: readonly DashboardFailure[],
): Map<string, DashboardFailure> {
  const latest = new Map<string, DashboardFailure>();
  for (const failure of failures) {
    const current = latest.get(failure.vendor_id);
    if (!current || new Date(failure.checked_at) > new Date(current.checked_at)) {
      latest.set(failure.vendor_id, failure);
    }
  }
  return latest;
}

const ERROR_TYPE_LABELS: Record<string, string> = {
  invalid_company_number: "Invalid company number",
  not_found: "Company not found",
  unauthorized: "Monitoring credentials rejected",
  rate_limited: "Rate limited by Companies House",
  unavailable: "Companies House unavailable",
  timeout: "Request to Companies House timed out",
  malformed_response: "Unexpected response from Companies House",
  network_error: "Network error contacting Companies House",
};

/** Humanizes a failure into a short label suitable for a tooltip. */
export function describeFailure(failure: DashboardFailure): string {
  return ERROR_TYPE_LABELS[failure.error_type] ?? failure.message ?? "Monitoring check failed";
}

/**
 * Coerces a raw alert row's severity into the closed set `buildDashboardSummary`
 * understands. Any value other than "critical"/"info" is treated as "attention" —
 * the deliberately conservative default for alert types the UI doesn't yet
 * specifically recognize.
 */
export function normalizeAlertSeverity(severity: string): "critical" | "attention" | "info" {
  return severity === "critical" || severity === "info" ? severity : "attention";
}

function monitoringStatus(value: string): MonitoringStatus {
  const known: MonitoringStatus[] = [
    "not_monitored",
    "baseline_pending",
    "monitoring",
    "current",
    "stale",
    "failing",
    "failed",
  ];
  return known.includes(value as MonitoringStatus) ? (value as MonitoringStatus) : "not_monitored";
}

export function buildDashboardSummary(
  vendors: readonly DashboardVendor[],
  unresolvedAlerts: readonly DashboardAlert[],
): DashboardSummary {
  const alertsByVendor = new Map<string, DashboardAlert[]>();
  for (const alert of unresolvedAlerts) {
    const current = alertsByVendor.get(alert.vendor_id) ?? [];
    current.push(alert);
    alertsByVendor.set(alert.vendor_id, current);
  }

  const healthByVendor = new Map<string, VendorHealth>();
  const healthCounts: Record<VendorHealth, number> = {
    healthy: 0,
    attention_required: 0,
    critical: 0,
    monitoring_issue: 0,
  };

  for (const vendor of vendors) {
    const health = calculateVendorHealth(
      monitoringStatus(vendor.monitoring_status),
      alertsByVendor.get(vendor.id) ?? [],
    );
    healthByVendor.set(vendor.id, health);
    healthCounts[health] += 1;
  }

  return {
    totalVendors: vendors.length,
    openAlerts: unresolvedAlerts.length,
    attentionAlerts: unresolvedAlerts.filter((alert) => alert.severity === "attention").length,
    healthByVendor,
    healthCounts,
  };
}
