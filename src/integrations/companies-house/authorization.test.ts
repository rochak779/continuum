import { describe, expect, it } from "vitest";

import { matchesMonitoredCompanyNumber } from "./authorization";

describe("matchesMonitoredCompanyNumber", () => {
  it("allows canonical equivalents of the vendor's stored identifier", () => {
    expect(matchesMonitoredCompanyNumber("SC123456", " sc123456 ")).toBe(true);
  });

  it("rejects missing, invalid and mismatched identifiers", () => {
    expect(matchesMonitoredCompanyNumber(null, "00000006")).toBe(false);
    expect(matchesMonitoredCompanyNumber("00000006", "bad")).toBe(false);
    expect(matchesMonitoredCompanyNumber("00000006", "00000007")).toBe(false);
  });
});
