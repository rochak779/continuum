import { describe, expect, it } from "vitest";

import {
  COMPANIES_HOUSE_MATERIALITY_RULES,
  COMPANIES_HOUSE_PROVIDER,
  isRiskCompanyStatus,
} from "./companies-house-rules";
import { classifyChange } from "./engine";
import { classifyCompaniesHouseChange } from "./index";
import type { MaterialityInput } from "./types";

function classify(attributeKey: string, previousValue: unknown, newValue: unknown) {
  const input: MaterialityInput = {
    provider: COMPANIES_HOUSE_PROVIDER,
    attributeKey,
    previousValue,
    newValue,
  };
  return classifyChange(input, COMPANIES_HOUSE_MATERIALITY_RULES);
}

const CRITICAL_STATUSES = ["dissolved", "liquidation"];

const ATTENTION_NON_OPERATIONAL_STATUSES = [
  "administration",
  "receivership",
  "receiver-action",
  "insolvency-proceedings",
  "voluntary-arrangement",
  "converted-closed",
  "closed",
  "removed",
];

const NON_OPERATIONAL_STATUSES = [...CRITICAL_STATUSES, ...ATTENTION_NON_OPERATIONAL_STATUSES];

describe("Companies House materiality rules — Critical", () => {
  it.each(CRITICAL_STATUSES)("classifies active -> %s as critical", (status) => {
    const result = classify("company_status", "active", status);

    expect(result.severity).toBe("critical");
    expect(result.explanation).toBe(`Company status changed from active to ${status}.`);
    expect(result.recommendedAction).toBe(
      "Review the vendor relationship and any pending financial or operational commitments immediately.",
    );
    expect(result.ruleId).toBe("companies_house.company_status.non_operational");
  });

  it("matches the ERD §21 worked example verbatim (active -> liquidation)", () => {
    const result = classify("company_status", "Active", "Liquidation");

    expect(result).toEqual({
      severity: "critical",
      explanation: "Company status changed from Active to Liquidation.",
      recommendedAction:
        "Review the vendor relationship and any pending financial or operational commitments immediately.",
      ruleId: "companies_house.company_status.non_operational",
    });
  });

  it("is case-insensitive when matching risk statuses", () => {
    const result = classify("company_status", "active", "DISSOLVED");
    expect(result.severity).toBe("critical");
  });

  it("still classifies as critical moving from one risk status to another", () => {
    const result = classify("company_status", "administration", "liquidation");
    expect(result.severity).toBe("critical");
  });

  it("does not classify active -> administration as critical (it's Attention, not Critical)", () => {
    const result = classify("company_status", "active", "administration");
    expect(result.severity).toBe("attention");
  });

  it("treats a transition into an unrecognised-but-clearly-non-operational status as attention, not silently critical", () => {
    // "voluntary-strike-off" isn't in the enumerated risk list — this
    // documents the deterministic engine's actual behaviour (only the
    // enumerated statuses trigger Critical) rather than claiming coverage
    // it doesn't have.
    const result = classify("company_status", "active", "voluntary-strike-off");
    expect(result.severity).toBe("attention");
  });
});

describe("Companies House materiality rules — Attention", () => {
  it.each(ATTENTION_NON_OPERATIONAL_STATUSES)(
    "classifies active -> %s as attention, not critical",
    (status) => {
      const result = classify("company_status", "active", status);

      expect(result.severity).toBe("attention");
      expect(result.ruleId).toBe("companies_house.company_status.other");
    },
  );

  it("classifies any other company_status transition as attention", () => {
    const result = classify("company_status", "active", "active-proposal-to-strike-off");

    expect(result.severity).toBe("attention");
    expect(result.ruleId).toBe("companies_house.company_status.other");
    expect(result.recommendedAction).toBeTruthy();
  });

  it("classifies a recovery out of a risk status as attention, not critical", () => {
    const result = classify("company_status", "administration", "active");

    expect(result.severity).toBe("attention");
    expect(result.ruleId).toBe("companies_house.company_status.other");
  });

  it("classifies a company name change as attention", () => {
    const result = classify("company_name", "Acme Ltd", "Acme Supplies Ltd");

    expect(result.severity).toBe("attention");
    expect(result.explanation).toBe("Company name changed from Acme Ltd to Acme Supplies Ltd.");
    expect(result.recommendedAction).toContain("name change");
    expect(result.ruleId).toBe("companies_house.company_name.changed");
  });

  it("classifies a registered office address change as attention", () => {
    const result = classify(
      "registered_office_address",
      "1 Old Street, London",
      "2 New Street, Manchester",
    );

    expect(result.severity).toBe("attention");
    expect(result.explanation).toContain("1 Old Street, London");
    expect(result.explanation).toContain("2 New Street, Manchester");
    expect(result.recommendedAction).toContain("registered address");
    expect(result.ruleId).toBe("companies_house.registered_office_address.changed");
  });

  it("classifies a SIC classification change as attention", () => {
    const result = classify("sic_codes", "62012", "64910, 64921");

    expect(result.severity).toBe("attention");
    expect(result.explanation).toContain("62012");
    expect(result.explanation).toContain("64910, 64921");
    expect(result.recommendedAction).toContain("SIC classification");
    expect(result.ruleId).toBe("companies_house.sic_codes.changed");
  });
});

describe("Companies House materiality rules — Informational (fallback)", () => {
  it.each([
    ["company_type", "ltd", "plc"],
    ["jurisdiction", "england-wales", "scotland"],
    ["accounts_next_due", "2026-01-01", "2026-06-01"],
    ["accounts_status", "filed", "overdue"],
    ["confirmation_statement_next_due", "2026-02-01", "2026-08-01"],
    ["date_of_creation", "2010-01-01", "2010-01-02"],
  ])("classifies %s changes as informational", (attributeKey, previous, next) => {
    const result = classify(attributeKey, previous, next);

    expect(result.severity).toBe("info");
    expect(result.ruleId).toBe("fallback.informational");
    expect(result.recommendedAction).toBeTruthy();
    expect(result.explanation).toBeTruthy();
  });

  it("classifies an attribute key no rule set has ever heard of as informational rather than throwing", () => {
    const result = classify("some_future_attribute", "x", "y");

    expect(result.severity).toBe("info");
    expect(result.ruleId).toBe("fallback.informational");
  });
});

describe("Companies House materiality rules — provider scoping", () => {
  it("does not apply Companies House rules to a change reported under a different provider", () => {
    const input: MaterialityInput = {
      provider: "gst",
      attributeKey: "company_status",
      previousValue: "active",
      newValue: "dissolved",
    };

    const result = classifyChange(input, COMPANIES_HOUSE_MATERIALITY_RULES);

    // No Companies House rule should fire for a "gst" change even though the
    // attribute key happens to collide; it falls through to Informational.
    expect(result.ruleId).toBe("fallback.informational");
  });
});

describe("classifyCompaniesHouseChange (convenience wrapper)", () => {
  it("produces the same result as calling the engine directly with the CH rule set", () => {
    const viaWrapper = classifyCompaniesHouseChange({
      attributeKey: "company_status",
      previousValue: "active",
      newValue: "dissolved",
    });
    const viaEngine = classify("company_status", "active", "dissolved");

    expect(viaWrapper).toEqual(viaEngine);
  });

  it("every result includes severity, explanation, and recommendedAction (ERD §21 requirement)", () => {
    const cases: Array<[string, unknown, unknown]> = [
      ["company_status", "active", "dissolved"],
      ["company_status", "active", "in-receivership"],
      ["company_name", "Old Name", "New Name"],
      ["registered_office_address", "A", "B"],
      ["sic_codes", "A", "B"],
      ["company_type", "ltd", "plc"],
    ];

    for (const [attributeKey, previousValue, newValue] of cases) {
      const result = classifyCompaniesHouseChange({ attributeKey, previousValue, newValue });
      expect(result.severity).toMatch(/^(critical|attention|info)$/);
      expect(typeof result.explanation).toBe("string");
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(typeof result.recommendedAction).toBe("string");
      expect(result.recommendedAction.length).toBeGreaterThan(0);
    }
  });
});

describe("isRiskCompanyStatus", () => {
  it("recognises every enumerated risk status, case-insensitively", () => {
    for (const status of NON_OPERATIONAL_STATUSES) {
      expect(isRiskCompanyStatus(status)).toBe(true);
      expect(isRiskCompanyStatus(status.toUpperCase())).toBe(true);
    }
  });

  it("returns false for benign statuses, null, and non-string values", () => {
    expect(isRiskCompanyStatus("active")).toBe(false);
    expect(isRiskCompanyStatus(null)).toBe(false);
    expect(isRiskCompanyStatus(undefined)).toBe(false);
    expect(isRiskCompanyStatus(42)).toBe(false);
  });
});
