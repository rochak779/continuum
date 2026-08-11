import { describe, expect, it } from "vitest";

import { buildChangeDedupeKey, detectChanges, monitoredSnapshotValues } from "./detect-changes";
import { normaliseCompanyProfile } from "./normalize";
import type { CompaniesHouseRawProfile } from "./types";

function snapshot(overrides: Partial<CompaniesHouseRawProfile> = {}) {
  return normaliseCompanyProfile({
    company_number: "00000006",
    company_name: "ACME LTD",
    company_status: "active",
    sic_codes: ["62012"],
    registered_office_address: { address_line_1: "1 High Street", postal_code: "EC1A 1AA" },
    ...overrides,
  });
}

describe("detectChanges", () => {
  it("compares only the initially monitored Trust Profile attributes", () => {
    const baseline = monitoredSnapshotValues(snapshot());
    expect(detectChanges(baseline, snapshot({ type: "plc" }))).toEqual([]);
  });

  it("detects status, name, registered address and SIC changes", () => {
    const changes = detectChanges(
      monitoredSnapshotValues(snapshot()),
      snapshot({
        company_status: "dissolved",
        company_name: "ACME GLOBAL LTD",
        registered_office_address: { address_line_1: "2 New Road" },
        sic_codes: ["63110"],
      }),
    );
    expect(changes.map((change) => change.attribute)).toEqual([
      "company_status",
      "company_name",
      "registered_address",
      "sic_codes",
    ]);
    expect(changes[0]?.severity).toBe("critical");
  });

  it("classifies a move into administration as attention, not critical", () => {
    const changes = detectChanges(
      monitoredSnapshotValues(snapshot()),
      snapshot({ company_status: "administration" }),
    );
    expect(changes[0]?.severity).toBe("attention");
  });

  it("classifies a move into liquidation as critical even from another risk status", () => {
    const changes = detectChanges(
      monitoredSnapshotValues(snapshot({ company_status: "administration" })),
      snapshot({ company_status: "liquidation" }),
    );
    expect(changes[0]?.severity).toBe("critical");
  });

  it("builds the same key for equivalent object states regardless of key order", () => {
    const a = buildChangeDedupeKey("vendor-1", "companies_house", {
      attribute: "registered_address",
      previousValue: { postal_code: "EC1", address_line_1: "1 High Street" },
      newValue: { address_line_1: "2 New Road", postal_code: "N1" },
      severity: "attention",
    });
    const b = buildChangeDedupeKey("vendor-1", "companies_house", {
      attribute: "registered_address",
      previousValue: { address_line_1: "1 High Street", postal_code: "EC1" },
      newValue: { postal_code: "N1", address_line_1: "2 New Road" },
      severity: "attention",
    });
    expect(a).toBe(b);
  });
});
