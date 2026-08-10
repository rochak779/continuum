export type VendorHealth = "healthy" | "attention_required" | "critical" | "monitoring_issue";

export type MonitoringStatus =
  | "not_monitored"
  | "baseline_pending"
  | "monitoring"
  | "current"
  | "stale"
  | "failing"
  | "failed";

export interface HealthAlert {
  severity: "critical" | "attention" | "info";
  status: string;
}

/**
 * Calculate business-facing vendor health from pipeline health and unresolved
 * alerts. A monitoring problem always wins: stale or failed evidence cannot
 * support either a Healthy or Critical classification.
 */
export function calculateVendorHealth(
  monitoringStatus: MonitoringStatus,
  alerts: readonly HealthAlert[],
): VendorHealth {
  if (monitoringStatus !== "monitoring" && monitoringStatus !== "current") {
    return "monitoring_issue";
  }

  const unresolved = alerts.filter((alert) => alert.status !== "resolved");
  if (unresolved.some((alert) => alert.severity === "critical")) return "critical";
  if (unresolved.some((alert) => alert.severity === "attention")) {
    return "attention_required";
  }
  return "healthy";
}

export const VENDOR_HEALTH_LABELS: Record<VendorHealth, string> = {
  healthy: "Healthy",
  attention_required: "Attention Required",
  critical: "Critical",
  monitoring_issue: "Monitoring Issue",
};
