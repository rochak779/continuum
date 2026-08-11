import { describe, expect, it } from "vitest";

import { buildDashboardSummary, describeFailure, latestFailureByVendor } from "./dashboard-data";

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

describe("latestFailureByVendor", () => {
  it("keeps only the most recent failure per vendor", () => {
    const result = latestFailureByVendor([
      { vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" },
      { vendor_id: "v1", error_type: "rate_limited", message: null, checked_at: "2026-08-03T00:00:00Z" },
      { vendor_id: "v2", error_type: "timeout", message: null, checked_at: "2026-08-02T00:00:00Z" },
    ]);

    expect(result.size).toBe(2);
    expect(result.get("v1")?.error_type).toBe("rate_limited");
    expect(result.get("v2")?.error_type).toBe("timeout");
  });

  it("does not assume input is pre-sorted", () => {
    const result = latestFailureByVendor([
      { vendor_id: "v1", error_type: "rate_limited", message: null, checked_at: "2026-08-03T00:00:00Z" },
      { vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" },
    ]);

    expect(result.get("v1")?.error_type).toBe("rate_limited");
  });

  it("returns an empty map for no failures", () => {
    expect(latestFailureByVendor([]).size).toBe(0);
  });
});

describe("describeFailure", () => {
  it("maps known error types to a human label", () => {
    expect(
      describeFailure({ vendor_id: "v1", error_type: "not_found", message: null, checked_at: "2026-08-01T00:00:00Z" }),
    ).toBe("Company not found");
  });

  it("falls back to the raw message for an unknown error type", () => {
    expect(
      describeFailure({
        vendor_id: "v1",
        error_type: "something_new",
        message: "Unexpected 503 from provider",
        checked_at: "2026-08-01T00:00:00Z",
      }),
    ).toBe("Unexpected 503 from provider");
  });

  it("falls back to a generic label with no error type match or message", () => {
    expect(
      describeFailure({ vendor_id: "v1", error_type: "something_new", message: null, checked_at: "2026-08-01T00:00:00Z" }),
    ).toBe("Monitoring check failed");
  });
});
