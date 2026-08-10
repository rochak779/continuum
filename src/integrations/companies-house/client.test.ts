import { describe, expect, it } from "vitest";

import { fetchCompanyProfile, normaliseCompanyNumber } from "./client";
import type { CompaniesHouseRawProfile } from "./types";

const API_KEY = "test-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// A fetch stub that returns a preset response and records the request.
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
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
};

describe("normaliseCompanyNumber", () => {
  it("accepts 8-digit and prefixed numbers, rejects junk", () => {
    expect(normaliseCompanyNumber("00000006")).toBe("00000006");
    expect(normaliseCompanyNumber(" sc123456 ")).toBe("SC123456");
    expect(normaliseCompanyNumber("123")).toBeNull();
    expect(normaliseCompanyNumber("not-a-number!")).toBeNull();
  });
});

describe("fetchCompanyProfile", () => {
  it("returns ok with data on a successful lookup", async () => {
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.company_name).toContain("MARINE");
    // Basic auth header with key as username, empty password.
    const auth = (calls[0]?.init?.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe(`Basic ${btoa(`${API_KEY}:`)}`);
    expect(calls[0]?.url).toContain("/company/00000006");
  });

  it("rejects an invalid company number before making a request", async () => {
    const { fn, calls } = stubFetch(jsonResponse(SAMPLE));
    const result = await fetchCompanyProfile("bad", { apiKey: API_KEY, fetchImpl: fn });

    expect(result).toMatchObject({ ok: false, errorType: "invalid_company_number" });
    expect(calls).toHaveLength(0); // never hit the network
  });

  it("maps 404 to not_found", async () => {
    const { fn } = stubFetch(jsonResponse({ errors: [] }, 404));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "not_found", httpStatus: 404 });
  });

  it("maps 401 to unauthorized", async () => {
    const { fn } = stubFetch(new Response("", { status: 401 }));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "unauthorized", httpStatus: 401 });
  });

  it("maps 429 to rate_limited and surfaces Retry-After", async () => {
    const response = new Response("", { status: 429, headers: { "Retry-After": "30" } });
    const { fn } = stubFetch(response);
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({
      ok: false,
      errorType: "rate_limited",
      httpStatus: 429,
      retryAfterSeconds: 30,
    });
  });

  it("maps 5xx to unavailable", async () => {
    const { fn } = stubFetch(new Response("", { status: 503 }));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "unavailable", httpStatus: 503 });
  });

  it("maps an aborted request to timeout", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { fn } = stubFetch(() => Promise.reject(abortError));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "timeout" });
  });

  it("maps other network errors to network_error", async () => {
    const { fn } = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "network_error" });
  });

  it("maps a non-JSON body to malformed_response", async () => {
    const bad = new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const { fn } = stubFetch(bad);
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "malformed_response" });
  });

  it("maps a JSON body missing core fields to malformed_response", async () => {
    const { fn } = stubFetch(jsonResponse({ foo: "bar" }));
    const result = await fetchCompanyProfile("00000006", { apiKey: API_KEY, fetchImpl: fn });
    expect(result).toMatchObject({ ok: false, errorType: "malformed_response" });
  });
});
