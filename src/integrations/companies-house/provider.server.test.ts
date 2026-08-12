import { afterEach, describe, expect, it, vi } from "vitest";

import { createCompaniesHouseProvider } from "./provider.server";
import type { CompaniesHouseRawProfile } from "./types";
import { fetchNormalizedSnapshot } from "../monitoring/run-provider-fetch";

const API_KEY = "test-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A fetch stub that returns a preset response and records the request.
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string }[] = [];
  const fn = (async (url: string | URL | Request) => {
    calls.push({ url: String(url) });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SAMPLE: CompaniesHouseRawProfile = {
  company_number: "00000006",
  company_name: "MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY",
  company_status: "active",
  type: "plc",
  date_of_creation: "1862-10-25",
  jurisdiction: "england-wales",
  sic_codes: ["65110"],
  registered_office_address: { address_line_1: "1 Test Street", postal_code: "EC1A 1AA" },
  accounts: { next_due: "2027-01-01" },
  confirmation_statement: { next_due: "2026-06-01" },
};

const originalApiKeyEnv = process.env["COMPANIES_HOUSE_API_KEY"];
const originalSandboxKeyEnv = process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"];
const originalEnvFlag = process.env["COMPANIES_HOUSE_ENV"];

afterEach(() => {
  if (originalApiKeyEnv === undefined) {
    delete process.env["COMPANIES_HOUSE_API_KEY"];
  } else {
    process.env["COMPANIES_HOUSE_API_KEY"] = originalApiKeyEnv;
  }
  if (originalSandboxKeyEnv === undefined) {
    delete process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"];
  } else {
    process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"] = originalSandboxKeyEnv;
  }
  if (originalEnvFlag === undefined) {
    delete process.env["COMPANIES_HOUSE_ENV"];
  } else {
    process.env["COMPANIES_HOUSE_ENV"] = originalEnvFlag;
  }
});

describe("createCompaniesHouseProvider metadata", () => {
  it("declares itself as a GB-only, COMPANIES_HOUSE_NUMBER provider", () => {
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });
    expect(provider.metadata).toEqual({
      providerId: "companies_house",
      displayName: "Companies House",
      supportedCountryCodes: ["GB"],
      requiredIdentifierType: "COMPANIES_HOUSE_NUMBER",
    });
  });
});

describe("createCompaniesHouseProvider validateIdentifier", () => {
  it("accepts a valid company number and canonicalises it", () => {
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });
    expect(provider.validateIdentifier(" sc123456 ")).toEqual({
      valid: true,
      normalizedValue: "SC123456",
    });
  });

  it("rejects invalid input without making a network call", async () => {
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });
    const result = provider.validateIdentifier("not-a-number!");
    expect(result.valid).toBe(false);
  });
});

describe("createCompaniesHouseProvider fetch: API key handling", () => {
  it("reads the sandbox key by default when COMPANIES_HOUSE_ENV is unset", async () => {
    delete process.env["COMPANIES_HOUSE_ENV"];
    process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"] = "env-sandbox-key";
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({});

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("api-sandbox.company-information.service.gov.uk");
  });

  it("reads the production key when COMPANIES_HOUSE_ENV=production", async () => {
    process.env["COMPANIES_HOUSE_ENV"] = "production";
    process.env["COMPANIES_HOUSE_API_KEY"] = "env-prod-key";
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({});

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("api.company-information.service.gov.uk");
    expect(calls[0]?.url).not.toContain("api-sandbox");
  });

  it("fails with a non-retryable authentication_error when no API key is configured", async () => {
    delete process.env["COMPANIES_HOUSE_ENV"];
    delete process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"];
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({});

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ type: "authentication_error", retryable: false });
    }
    expect(calls).toHaveLength(0); // never hit the network without a key
  });
});

describe("createCompaniesHouseProvider fetch: error mapping", () => {
  const cases: {
    name: string;
    response: Response | (() => Promise<Response>);
    expected: { type: string; retryable: boolean; httpStatus?: number };
  }[] = [
    {
      name: "401 -> authentication_error, not retryable",
      response: new Response("", { status: 401 }),
      expected: { type: "authentication_error", retryable: false, httpStatus: 401 },
    },
    {
      name: "404 -> not_found, not retryable",
      response: jsonResponse({ errors: [] }, 404),
      expected: { type: "not_found", retryable: false, httpStatus: 404 },
    },
    {
      name: "429 -> rate_limited, retryable",
      response: new Response("", { status: 429, headers: { "Retry-After": "30" } }),
      expected: { type: "rate_limited", retryable: true, httpStatus: 429 },
    },
    {
      name: "503 -> provider_unavailable, retryable",
      response: new Response("", { status: 503 }),
      expected: { type: "provider_unavailable", retryable: true, httpStatus: 503 },
    },
    {
      name: "malformed JSON body -> malformed_response, not retryable",
      response: new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      expected: { type: "malformed_response", retryable: false },
    },
    {
      name: "JSON body missing core fields -> malformed_response, not retryable",
      response: jsonResponse({ foo: "bar" }),
      expected: { type: "malformed_response", retryable: false },
    },
  ];

  for (const { name, response, expected } of cases) {
    it(`maps ${name}`, async () => {
      const { fn } = stubFetch(response);
      const provider = createCompaniesHouseProvider({ apiKey: API_KEY });

      const result = await provider.fetch("00000006", { fetchImpl: fn });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject(expected);
      }
    });
  }

  it("maps a timed-out request to network_error, retryable", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { fn } = stubFetch(() => Promise.reject(abortError));
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ type: "network_error", retryable: true });
    }
  });

  it("maps an underlying network failure to network_error, retryable", async () => {
    const { fn } = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ type: "network_error", retryable: true });
    }
  });
});

describe("createCompaniesHouseProvider fetch: success path", () => {
  it("returns the raw payload with a fetchedAt timestamp", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const { fn } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY, now: () => fixedNow });

    const result = await provider.fetch("00000006", { fetchImpl: fn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw).toEqual(SAMPLE);
      expect(result.fetchedAt).toBe(fixedNow.toISOString());
    }
  });
});

describe("createCompaniesHouseProvider normalize", () => {
  it("normalises the ERD §17 field list", () => {
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });
    const normalized = provider.normalize(SAMPLE);

    expect(normalized).toEqual({
      companyNumber: "00000006",
      companyName: "MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY",
      companyStatus: "active",
      companyType: "plc",
      registeredOfficeAddress: { address_line_1: "1 Test Street", postal_code: "EC1A 1AA" },
      dateOfCreation: "1862-10-25",
      jurisdiction: "england-wales",
      accountsNextDue: "2027-01-01",
      accountsStatus: "due",
      confirmationStatementNextDue: "2026-06-01",
      confirmationStatementStatus: "due",
      sicCodes: ["65110"],
    });
  });
});

describe("createCompaniesHouseProvider through the monitoring framework", () => {
  it("produces a NormalizedSnapshot end to end via fetchNormalizedSnapshot", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const { fn } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY, now: () => fixedNow });

    const result = await fetchNormalizedSnapshot(provider, " 00000006 ", { fetchImpl: fn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.provider).toBe("companies_house");
      expect(result.snapshot.vendorIdentifier).toBe("00000006");
      expect(result.snapshot.fetchedAt).toBe(fixedNow.toISOString());
      expect(result.snapshot.normalizedData.companyStatus).toBe("active");
      expect(result.snapshot.rawData).toEqual(SAMPLE);
    }
  });

  it("short-circuits an invalid company number before any network call", async () => {
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const provider = createCompaniesHouseProvider({ apiKey: API_KEY });
    const fetchSpy = vi.spyOn(provider, "fetch");

    const result = await fetchNormalizedSnapshot(provider, "not-a-number!", { fetchImpl: fn });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("validation_error");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
