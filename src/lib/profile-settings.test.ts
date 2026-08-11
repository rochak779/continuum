import { describe, expect, it } from "vitest";

import { joinPhoneForStorage, splitStoredPhone } from "./profile-settings";

describe("splitStoredPhone", () => {
  it("returns an empty phone and the default dial code for null", () => {
    expect(splitStoredPhone(null)).toEqual({ dialCode: "+1", phone: "" });
  });

  it("returns an empty phone and the default dial code for an empty string", () => {
    expect(splitStoredPhone("")).toEqual({ dialCode: "+1", phone: "" });
  });

  it("splits a recognised dial code from the rest of the number", () => {
    expect(splitStoredPhone("+91 9876543210")).toEqual({
      dialCode: "+91",
      phone: "9876543210",
    });
  });

  it("keeps internal spaces in the number intact", () => {
    expect(splitStoredPhone("+1 415 555 0100")).toEqual({
      dialCode: "+1",
      phone: "415 555 0100",
    });
  });

  it("falls back to the default dial code when the prefix isn't a known dial code", () => {
    expect(splitStoredPhone("07123 456789")).toEqual({
      dialCode: "+1",
      phone: "07123 456789",
    });
  });
});

describe("joinPhoneForStorage", () => {
  it("joins a dial code and number with a space", () => {
    expect(joinPhoneForStorage("+91", "9876543210")).toBe("+91 9876543210");
  });

  it("trims the number before joining", () => {
    expect(joinPhoneForStorage("+1", "  415 555 0100  ")).toBe("+1 415 555 0100");
  });

  it("returns an empty string when the number is blank", () => {
    expect(joinPhoneForStorage("+1", "   ")).toBe("");
  });
});
