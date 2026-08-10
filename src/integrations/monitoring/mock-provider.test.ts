import { describe, expect, it } from "vitest";

import { createMockProvider } from "./mock-provider";

describe("createMockProvider metadata", () => {
  it("uses sensible defaults and allows overrides", () => {
    const defaultProvider = createMockProvider();
    expect(defaultProvider.metadata).toEqual({
      providerId: "mock_provider",
      displayName: "Mock Provider",
      supportedCountryCodes: "any",
      requiredIdentifierType: "MOCK_ID",
    });

    const customProvider = createMockProvider({
      metadata: { providerId: "mock_gst", requiredIdentifierType: "GSTIN" },
    });
    expect(customProvider.metadata.providerId).toBe("mock_gst");
    expect(customProvider.metadata.requiredIdentifierType).toBe("GSTIN");
    expect(customProvider.metadata.displayName).toBe("Mock Provider");
  });
});

describe("createMockProvider validateIdentifier", () => {
  it("accepts any non-empty, non-blacklisted identifier and trims it", () => {
    const provider = createMockProvider();
    expect(provider.validateIdentifier("  12345678  ")).toEqual({
      valid: true,
      normalizedValue: "12345678",
    });
  });

  it("rejects an empty identifier", () => {
    const provider = createMockProvider();
    const result = provider.validateIdentifier("   ");
    expect(result.valid).toBe(false);
  });

  it("rejects identifiers explicitly configured as invalid", () => {
    const provider = createMockProvider({ invalidIdentifiers: ["BAD123"] });
    const result = provider.validateIdentifier("BAD123");
    expect(result).toEqual({
      valid: false,
      reason: '"BAD123" is not a valid MOCK_ID.',
    });
  });
});

describe("createMockProvider fetch", () => {
  it("returns not_found for an identifier with no configured response", async () => {
    const provider = createMockProvider();
    const result = await provider.fetch("12345678");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("not_found");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("returns the configured raw payload with a fetchedAt timestamp", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const provider = createMockProvider({
      responses: { "12345678": { status: "active" } },
      now: () => fixedNow,
    });

    const result = await provider.fetch("12345678");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw).toEqual({ status: "active" });
      expect(result.fetchedAt).toBe(fixedNow.toISOString());
    }
  });

  it("returns a configured ProviderError verbatim", async () => {
    const provider = createMockProvider({
      responses: {
        "12345678": {
          type: "rate_limited",
          message: "slow down",
          retryable: true,
          httpStatus: 429,
        },
      },
    });

    const result = await provider.fetch("12345678");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: "rate_limited",
        message: "slow down",
        retryable: true,
        httpStatus: 429,
      });
    }
  });
});

describe("createMockProvider normalize", () => {
  it("defaults to a shallow copy of the raw data", () => {
    const provider = createMockProvider();
    const raw = { status: "active" };
    const normalized = provider.normalize(raw);
    expect(normalized).toEqual(raw);
    expect(normalized).not.toBe(raw);
  });

  it("uses a custom normalize function when provided", () => {
    const provider = createMockProvider({
      normalize: (raw) => ({ statusUpper: String(raw["status"]).toUpperCase() }),
    });
    expect(provider.normalize({ status: "active" })).toEqual({ statusUpper: "ACTIVE" });
  });
});
