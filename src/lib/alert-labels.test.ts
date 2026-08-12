import { describe, expect, it } from "vitest";

import { displayValue } from "./alert-labels";

describe("displayValue", () => {
  it("renders null as 'Not provided'", () => {
    expect(displayValue(null)).toBe("Not provided");
  });

  it("joins array values with a comma", () => {
    expect(displayValue(["62020", "62090"])).toBe("62020, 62090");
  });

  it("joins object values, dropping falsy entries", () => {
    expect(
      displayValue({ locality: "London", region: null, postal_code: "EC1A 1BB" }),
    ).toBe("London, EC1A 1BB");
  });

  it("stringifies primitive values", () => {
    expect(displayValue("active")).toBe("active");
  });
});
