import { describe, expect, it } from "vitest";

import {
  buildDashboardSummary,
  buildUpcomingExpiries,
  describeFailure,
  latestFailureByVendor,
  normalizeAlertSeverity,
} from "./dashboard-data";

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
    expect(summary.attentionAlerts).toBe(1);
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

describe("normalizeAlertSeverity", () => {
  it("keeps critical as critical", () => {
    expect(normalizeAlertSeverity("critical")).toBe("critical");
  });

  it("keeps info as info", () => {
    expect(normalizeAlertSeverity("info")).toBe("info");
  });

  it("coerces an unknown severity to attention", () => {
    expect(normalizeAlertSeverity("warning")).toBe("attention");
  });
});

describe("buildUpcomingExpiries", () => {
  const vendorNames = new Map([
    ["v1", "Acme Insurance"],
    ["v2", "Beta Logistics"],
  ]);

  it("joins vendor names and prefers item_label over file_name", () => {
    const result = buildUpcomingExpiries(
      [
        {
          id: "d1",
          vendor_id: "v1",
          item_label: "Insurance Certificate",
          file_name: "cert.pdf",
          expiry_date: "2027-01-15",
        },
      ],
      vendorNames,
    );
    expect(result).toEqual([
      { id: "d1", companyName: "Acme Insurance", item: "Insurance Certificate", expiryDate: "2027-01-15" },
    ]);
  });

  it("falls back to file_name when item_label is null", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: null, file_name: "cert.pdf", expiry_date: "2027-01-15" }],
      vendorNames,
    );
    expect(result[0]?.item).toBe("cert.pdf");
  });

  it("falls back to 'Unknown vendor' when the vendor id isn't in the map", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "missing", item_label: "X", file_name: "x.pdf", expiry_date: "2027-01-15" }],
      vendorNames,
    );
    expect(result[0]?.companyName).toBe("Unknown vendor");
  });

  it("excludes documents with a null expiry_date", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: "X", file_name: "x.pdf", expiry_date: null }],
      vendorNames,
    );
    expect(result).toEqual([]);
  });

  it("excludes already-past expiry dates", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: "X", file_name: "x.pdf", expiry_date: "2000-01-01" }],
      vendorNames,
    );
    expect(result).toEqual([]);
  });

  it("sorts by soonest expiry first, defensively re-sorting unsorted input", () => {
    const result = buildUpcomingExpiries(
      [
        { id: "later", vendor_id: "v1", item_label: "Later", file_name: "x.pdf", expiry_date: "2030-01-01" },
        { id: "sooner", vendor_id: "v2", item_label: "Sooner", file_name: "y.pdf", expiry_date: "2028-01-01" },
      ],
      vendorNames,
    );
    expect(result.map((r) => r.id)).toEqual(["sooner", "later"]);
  });
});
