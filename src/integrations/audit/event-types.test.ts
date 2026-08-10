import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "./event-types";

// ERD §13's exact "Examples" list — the canonical vocabulary this module
// exists to centralise.
const ERD_EXAMPLE_EVENT_TYPES = [
  "vendor_created",
  "identifier_added",
  "monitoring_started",
  "monitoring_failed",
  "baseline_created",
  "change_detected",
  "alert_created",
  "alert_assigned",
  "alert_resolved",
  "trust_profile_updated",
];

describe("AUDIT_EVENT_TYPES", () => {
  it("covers every ERD §13 example event type, value-for-value", () => {
    expect(Object.values(AUDIT_EVENT_TYPES).sort()).toEqual([...ERD_EXAMPLE_EVENT_TYPES].sort());
  });

  it("has no duplicate values", () => {
    const values = Object.values(AUDIT_EVENT_TYPES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every value is snake_case (matches the ERD's own naming convention)", () => {
    for (const value of Object.values(AUDIT_EVENT_TYPES)) {
      expect(value).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});
