import { describe, expect, it } from "vitest";

import { calculateVendorHealth } from "./vendor-health";

describe("calculateVendorHealth", () => {
  it("is Healthy when monitoring is current and there are no actionable alerts", () => {
    expect(calculateVendorHealth("monitoring", [])).toBe("healthy");
    expect(
      calculateVendorHealth("current", [
        { severity: "info", status: "open" },
        { severity: "critical", status: "resolved" },
      ]),
    ).toBe("healthy");
  });

  it("is Attention Required for an unresolved attention alert", () => {
    expect(calculateVendorHealth("monitoring", [{ severity: "attention", status: "open" }])).toBe(
      "attention_required",
    );
  });

  it("is Critical for an unresolved critical alert", () => {
    expect(
      calculateVendorHealth("monitoring", [
        { severity: "attention", status: "open" },
        { severity: "critical", status: "acknowledged" },
      ]),
    ).toBe("critical");
  });

  it.each(["stale", "failing", "failed"] as const)(
    "is Monitoring Issue when monitoring is %s",
    (status) => {
      expect(calculateVendorHealth(status, [])).toBe("monitoring_issue");
    },
  );

  it("does not classify a monitoring failure as Healthy or Critical", () => {
    expect(calculateVendorHealth("failed", [])).toBe("monitoring_issue");
    expect(
      calculateVendorHealth("failed", [{ severity: "critical", status: "open" }]),
    ).toBe("monitoring_issue");
  });

  it("does not treat pending or unmonitored evidence as Healthy", () => {
    expect(calculateVendorHealth("baseline_pending", [])).toBe("monitoring_issue");
    expect(calculateVendorHealth("not_monitored", [])).toBe("monitoring_issue");
  });
});
