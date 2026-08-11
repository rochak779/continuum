import { describe, expect, it } from "vitest";

import { normalizeExtractedDate } from "./normalize-extraction";

describe("normalizeExtractedDate", () => {
  it("passes through a valid ISO date", () => {
    expect(normalizeExtractedDate("2027-01-15")).toBe("2027-01-15");
  });

  it("returns null for null input", () => {
    expect(normalizeExtractedDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeExtractedDate(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeExtractedDate("")).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(normalizeExtractedDate("not a date")).toBeNull();
  });

  it("returns null for a non-date string like a document number", () => {
    expect(normalizeExtractedDate("INV-2027-001")).toBeNull();
  });

  it("normalizes a parseable but non-ISO date string to ISO", () => {
    expect(normalizeExtractedDate("January 15, 2027")).toBe("2027-01-15");
  });
});
