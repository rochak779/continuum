import { describe, expect, it } from "vitest";
import { formatRegisteredOfficeAddress, formatSicCodes } from "./vendor-detail";

describe("formatRegisteredOfficeAddress", () => {
  it("joins present address parts in order", () => {
    expect(
      formatRegisteredOfficeAddress({
        premises: "Unit 4",
        address_line_1: "12 High Street",
        locality: "London",
        postal_code: "EC1A 1BB",
        country: "United Kingdom",
      }),
    ).toBe("Unit 4, 12 High Street, London, EC1A 1BB, United Kingdom");
  });

  it("skips missing parts without leaving empty gaps", () => {
    expect(
      formatRegisteredOfficeAddress({
        address_line_1: "12 High Street",
        country: "United Kingdom",
      }),
    ).toBe("12 High Street, United Kingdom");
  });

  it("omits po_box from the formatted output", () => {
    expect(
      formatRegisteredOfficeAddress({
        po_box: "PO Box 123",
        locality: "London",
      }),
    ).toBe("London");
  });

  it("returns an em dash placeholder for null", () => {
    expect(formatRegisteredOfficeAddress(null)).toBe("—");
  });

  it("returns an em dash placeholder for undefined", () => {
    expect(formatRegisteredOfficeAddress(undefined)).toBe("—");
  });

  it("returns an em dash placeholder for an empty object", () => {
    expect(formatRegisteredOfficeAddress({})).toBe("—");
  });
});

describe("formatSicCodes", () => {
  it("joins codes with a comma", () => {
    expect(formatSicCodes(["62012", "70229"])).toBe("62012, 70229");
  });

  it("returns an em dash placeholder for null", () => {
    expect(formatSicCodes(null)).toBe("—");
  });

  it("returns an em dash placeholder for undefined", () => {
    expect(formatSicCodes(undefined)).toBe("—");
  });

  it("returns an em dash placeholder for an empty array", () => {
    expect(formatSicCodes([])).toBe("—");
  });
});
