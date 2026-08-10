import { describe, expect, it } from "vitest";

import { buildDashboardSummary } from "./dashboard-data";

describe("buildDashboardSummary", () => {
  it("aggregates vendor health and unresolved alerts for the dashboard", () => {
    const summary = buildDashboardSummary(
      [
        { id: "healthy", monitoring_status: "monitoring" },
        { id: "attention", monitoring_status: "monitoring" },
        { id: "critical", monitoring_status: "monitoring" },
        { id: "failed", monitoring_status: "failing" },
      ],
      [
        { id: "a1", vendor_id: "attention", severity: "attention", status: "open" },
        { id: "a2", vendor_id: "critical", severity: "critical", status: "open" },
        { id: "a3", vendor_id: "failed", severity: "critical", status: "open" },
      ],
    );

    expect(summary.totalVendors).toBe(4);
    expect(summary.openAlerts).toBe(3);
    expect(summary.healthCounts).toEqual({
      healthy: 1,
      attention_required: 1,
      critical: 1,
      monitoring_issue: 1,
    });
    expect(summary.healthByVendor.get("failed")).toBe("monitoring_issue");
  });
});
