import { describe, expect, it, vi } from "vitest";

import { createMockProvider } from "./mock-provider";
import { fetchNormalizedSnapshot } from "./run-provider-fetch";
import type { ExternalVendorDataProvider } from "./types";

describe("fetchNormalizedSnapshot", () => {
  it("assembles a NormalizedSnapshot on the success path", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const provider = createMockProvider({
      metadata: { providerId: "mock_provider", requiredIdentifierType: "MOCK_ID" },
      responses: { "12345678": { status: "active", name: "Acme Ltd" } },
      normalize: (raw) => ({ companyStatus: raw["status"] }),
      now: () => fixedNow,
    });

    const result = await fetchNormalizedSnapshot(provider, "12345678");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toEqual({
        provider: "mock_provider",
        vendorIdentifier: "12345678",
        fetchedAt: fixedNow.toISOString(),
        normalizedData: { companyStatus: "active" },
        rawData: { status: "active", name: "Acme Ltd" },
        providerReference: null,
      });
    }
  });

  it("trims/normalizes the identifier before fetching", async () => {
    const provider = createMockProvider({
      responses: { "12345678": { status: "active" } },
    });

    const result = await fetchNormalizedSnapshot(provider, "  12345678  ");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.vendorIdentifier).toBe("12345678");
    }
  });

  it("short-circuits on an invalid identifier and never calls fetch", async () => {
    const provider = createMockProvider({ invalidIdentifiers: ["BAD"] });
    const fetchSpy = vi.spyOn(provider, "fetch");

    const result = await fetchNormalizedSnapshot(provider, "BAD");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("validation_error");
      expect(result.error.retryable).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates a provider fetch failure untouched", async () => {
    const provider = createMockProvider({
      responses: {
        "12345678": {
          type: "provider_unavailable",
          message: "upstream is down",
          retryable: true,
          httpStatus: 503,
        },
      },
    });

    const result = await fetchNormalizedSnapshot(provider, "12345678");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        type: "provider_unavailable",
        message: "upstream is down",
        retryable: true,
        httpStatus: 503,
      });
    }
  });

  it("carries providerReference through when the provider supplies one", async () => {
    const provider: ExternalVendorDataProvider<{ ok: boolean }, { ok: boolean }> = {
      metadata: {
        providerId: "mock_with_reference",
        displayName: "Mock With Reference",
        supportedCountryCodes: "any",
        requiredIdentifierType: "MOCK_ID",
      },
      validateIdentifier: (v) => ({ valid: true, normalizedValue: v }),
      fetch: async () => ({
        ok: true,
        raw: { ok: true },
        fetchedAt: "2026-01-01T00:00:00.000Z",
        providerReference: "req-abc-123",
      }),
      normalize: (raw) => raw,
    };

    const result = await fetchNormalizedSnapshot(provider, "id-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.providerReference).toBe("req-abc-123");
    }
  });

  it("never throws when the provider's fetch rejects unexpectedly (contract, not caught here)", async () => {
    // fetchNormalizedSnapshot trusts the provider contract (never throws);
    // this test documents that an out-of-contract provider's rejection
    // propagates rather than being silently swallowed, so a misbehaving
    // provider fails loudly during development.
    const provider = createMockProvider();
    vi.spyOn(provider, "fetch").mockRejectedValueOnce(new Error("boom"));

    await expect(fetchNormalizedSnapshot(provider, "12345678")).rejects.toThrow("boom");
  });
});
