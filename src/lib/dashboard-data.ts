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
  healthByVendor: Map<string, VendorHealth>;
  healthCounts: Record<VendorHealth, number>;
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
    healthByVendor,
    healthCounts,
  };
}
