// HTTP adapter for the official UK Companies House REST API.
//
// This is the ONLY place that talks to Companies House over the network.
// Vendor components / server functions must go through this adapter so the
// API key handling, auth scheme and error mapping live in one place.
//
// Auth: Companies House uses HTTP Basic auth with the API key as the username
// and an empty password (https://developer.company-information.service.gov.uk).
//
// The adapter never throws for expected failure modes — it returns a
// discriminated `CompaniesHouseResult` so callers handle each case explicitly.

import type { CompaniesHouseRawProfile, CompaniesHouseResult } from "./types";

const DEFAULT_BASE_URL = "https://api.company-information.service.gov.uk";
const DEFAULT_TIMEOUT_MS = 10_000;

// Companies House numbers are 8 characters: all digits (e.g. "09876543") or a
// two-letter prefix + 6 digits (e.g. "SC123456", "OC334758", "NI123456").
const COMPANY_NUMBER_PATTERN = /^[A-Z0-9]{8}$/;

export interface CompaniesHouseClientOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  // Injectable for tests; defaults to global fetch.
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Normalise a user-supplied company number to the canonical form used by the
 * API (uppercased, whitespace stripped). Returns null if it is not a valid
 * Companies House number.
 */
export function normaliseCompanyNumber(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  return COMPANY_NUMBER_PATTERN.test(cleaned) ? cleaned : null;
}

function buildAuthHeader(apiKey: string): string {
  // btoa is available in browsers, Workers and Node 16+. Fall back to Buffer.
  const raw = `${apiKey}:`;
  const encoded =
    typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * Fetch a single company profile from Companies House.
 * Guaranteed not to throw — every outcome is encoded in the returned result.
 */
export async function fetchCompanyProfile(
  companyNumber: string,
  options: CompaniesHouseClientOptions,
): Promise<CompaniesHouseResult> {
  const { apiKey, baseUrl = DEFAULT_BASE_URL, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const canonical = normaliseCompanyNumber(companyNumber);
  if (!canonical) {
    return {
      ok: false,
      errorType: "invalid_company_number",
      message: `"${companyNumber}" is not a valid Companies House company number.`,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      errorType: "unauthorized",
      message: "COMPANIES_HOUSE_API_KEY is not configured.",
    };
  }

  const url = `${baseUrl}/company/${canonical}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: buildAuthHeader(apiKey),
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    // AbortError => timeout; anything else => network-level failure.
    const isAbort = error instanceof Error && error.name === "AbortError";
    return isAbort
      ? { ok: false, errorType: "timeout", message: `Request timed out after ${timeoutMs}ms.` }
      : {
          ok: false,
          errorType: "network_error",
          message: error instanceof Error ? error.message : "Network request failed.",
        };
  } finally {
    clearTimeout(timer);
  }

  // Map HTTP status codes to typed failures before attempting to parse a body.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      errorType: "unauthorized",
      message: "Companies House rejected the API key (401/403).",
      httpStatus: response.status,
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      errorType: "not_found",
      message: `Company ${canonical} was not found at Companies House.`,
      httpStatus: 404,
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      errorType: "rate_limited",
      message: "Companies House rate limit exceeded (429).",
      httpStatus: 429,
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
    };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      errorType: "unavailable",
      message: `Companies House is unavailable (HTTP ${response.status}).`,
      httpStatus: response.status,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      errorType: "unavailable",
      message: `Unexpected Companies House response (HTTP ${response.status}).`,
      httpStatus: response.status,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      errorType: "malformed_response",
      message: "Companies House returned a body that was not valid JSON.",
      httpStatus: response.status,
    };
  }

  if (!body || typeof body !== "object") {
    return {
      ok: false,
      errorType: "malformed_response",
      message: "Companies House returned an unexpected (non-object) payload.",
      httpStatus: response.status,
    };
  }

  const profile = body as CompaniesHouseRawProfile;
  // A profile with neither a company number nor a name is not usable.
  if (!profile.company_number && !profile.company_name) {
    return {
      ok: false,
      errorType: "malformed_response",
      message: "Companies House payload was missing core company fields.",
      httpStatus: response.status,
    };
  }

  return { ok: true, data: profile };
}
