import { describe, expect, it } from "vitest";

import { buildAlertDedupeKey, detectChanges } from "./detect-changes";
import { normaliseCompanyProfile } from "./normalize";
import type { CompaniesHouseRawProfile } from "./types";

function snapshot(overrides: Partial<CompaniesHouseRawProfile> = {}) {
  return normaliseCompanyProfile({
    company_number: "00000006",
    company_name: "ACME LTD",
    company_status: "active",
    type: "ltd",
    date_of_creation: "2000-01-01",
    jurisdiction: "england-wales",
    sic_codes: ["62012"],
    registered_office_address: { address_line_1: "1 High Street", postal_code: "EC1A 1AA" },
    ...overrides,
  });
}

describe("detectChanges", () => {
  it("returns no changes when there is no previous snapshot (baseline)", () => {
    expect(detectChanges(null, snapshot())).toEqual([]);
  });

  it("returns no changes when the data is unchanged", () => {
    expect(detectChanges(snapshot(), snapshot())).toEqual([]);
  });

  it("flags active -> dissolved as critical", () => {
    const changes = detectChanges(snapshot(), snapshot({ company_status: "dissolved" }));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      attribute: "company_status",
      previousValue: "active",
      newValue: "dissolved",
      severity: "critical",
    });
  });

  it("flags active -> liquidation and active -> administration as critical", () => {
    for (const status of ["liquidation", "administration"]) {
      const changes = detectChanges(snapshot(), snapshot({ company_status: status }));
      expect(changes[0]).toMatchObject({ attribute: "company_status", severity: "critical" });
    }
  });

  it("flags a registered office address change as attention", () => {
    const changes = detectChanges(
      snapshot(),
      snapshot({
        registered_office_address: { address_line_1: "2 New Road", postal_code: "N1 1AA" },
      }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      attribute: "registered_office_address",
      severity: "attention",
    });
    expect(changes[0]?.newValue).toContain("2 New Road");
  });

  it("flags a company name change as attention", () => {
    const changes = detectChanges(snapshot(), snapshot({ company_name: "ACME GLOBAL LTD" }));
    expect(changes[0]).toMatchObject({ attribute: "company_name", severity: "attention" });
  });

  it("flags a SIC code change as attention", () => {
    const changes = detectChanges(snapshot(), snapshot({ sic_codes: ["62012", "63110"] }));
    expect(changes[0]).toMatchObject({ attribute: "sic_codes", severity: "attention" });
  });

  it("treats company type / accounts date changes as info", () => {
    const changes = detectChanges(
      snapshot(),
      snapshot({ type: "plc", accounts: { next_due: "2027-01-01" } }),
    );
    const byAttr = Object.fromEntries(changes.map((c) => [c.attribute, c.severity]));
    expect(byAttr["company_type"]).toBe("info");
    expect(byAttr["accounts_next_due"]).toBe("info");
  });

  it("produces a stable dedupe key for the same transition", () => {
    const [change] = detectChanges(snapshot(), snapshot({ company_status: "dissolved" }));
    const a = buildAlertDedupeKey("vendor-1", "companies_house", change!);
    const b = buildAlertDedupeKey("vendor-1", "companies_house", change!);
    expect(a).toBe(b);
    expect(a).toContain("company_status");
    // A different vendor yields a different key.
    expect(buildAlertDedupeKey("vendor-2", "companies_house", change!)).not.toBe(a);
  });
});
