import { describe, expect, it } from "vitest";

import {
  buildChangeDedupeKey,
  detectBaselineChanges,
  detectChanges,
  monitoredSnapshotValues,
} from "./detect-changes";
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

  it("flags accounts becoming overdue as attention", () => {
    const changes = detectChanges(
      monitoredSnapshotValues(snapshot()),
      snapshot({ accounts: { overdue: true } }),
    );
    const accountsChange = changes.find((change) => change.attribute === "accounts_status");
    expect(accountsChange).toEqual({
      attribute: "accounts_status",
      previousValue: null,
      newValue: "overdue",
      severity: "attention",
    });
  });

  it("flags the confirmation statement becoming overdue as attention", () => {
    const changes = detectChanges(
      monitoredSnapshotValues(snapshot()),
      snapshot({ confirmation_statement: { overdue: true } }),
    );
    const confirmationChange = changes.find(
      (change) => change.attribute === "confirmation_statement_status",
    );
    expect(confirmationChange).toEqual({
      attribute: "confirmation_statement_status",
      previousValue: null,
      newValue: "overdue",
      severity: "attention",
    });
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

describe("detectBaselineChanges", () => {
  it("flags nothing for a vendor that's active on its first check", () => {
    expect(detectBaselineChanges(snapshot({ company_status: "active" }))).toEqual([]);
  });

  it("flags a vendor that's already dissolved on its first check as critical", () => {
    const changes = detectBaselineChanges(snapshot({ company_status: "dissolved" }));
    expect(changes).toEqual([
      {
        attribute: "company_status",
        previousValue: "active",
        newValue: "dissolved",
        severity: "critical",
      },
    ]);
  });

  it("flags a vendor that's already in administration on its first check as attention", () => {
    const changes = detectBaselineChanges(snapshot({ company_status: "administration" }));
    expect(changes[0]?.severity).toBe("attention");
  });
});
