// The official Companies House provider, implemented against the
// provider-independent monitoring framework (src/integrations/monitoring).
//
// This wires together pieces that already existed and were already unit
// tested individually:
//   - validateIdentifier -> normaliseCompanyNumber (./client)
//   - fetch              -> fetchCompanyProfile (./client): the HTTP adapter,
//                            with its existing 401/404/429/5xx/timeout/
//                            malformed-response handling (ERD §25)
//   - normalize           -> normaliseCompanyProfile (./normalize): maps the
//                            raw payload onto the ERD §17 field list
//
// Server-only file (TanStack Start strips `.server.ts` from the client
// bundle, same convention as client.server.ts / monitor.server.ts): the
// Companies House API key is read from process.env.COMPANIES_HOUSE_API_KEY
// here and must never be read from client code or included in a response.
//
// Change detection (comparing this snapshot against a vendor's Trust
// Profile) is explicitly out of scope for this provider — see
// docs/database-design.md / ERD §19 for where that lives.

import { fetchCompanyProfile, normaliseCompanyNumber } from "./client";
import { normaliseCompanyProfile } from "./normalize";
import { COMPANIES_HOUSE_SOURCE } from "./types";
import type {
  CompaniesHouseErrorType,
  CompaniesHouseRawProfile,
  NormalisedCompanySnapshot,
} from "./types";
import type {
  ExternalVendorDataProvider,
  IdentifierValidationResult,
  ProviderError,
  ProviderErrorType,
  ProviderFetchOptions,
  ProviderFetchResult,
  ProviderMetadata,
} from "../monitoring/types";

export const COMPANIES_HOUSE_METADATA: ProviderMetadata = {
  providerId: COMPANIES_HOUSE_SOURCE,
  displayName: "Companies House",
  supportedCountryCodes: ["GB"],
  requiredIdentifierType: "COMPANIES_HOUSE_NUMBER",
};

// Maps the Companies House client's specific error vocabulary onto the
// framework's provider-agnostic one (ERD §25), and encodes the ERD §26
// retry policy once, here, rather than leaving it to every caller:
// retry timeout / network / rate-limit / 5xx; never retry invalid input,
// 404, or an auth failure until credentials change.
const ERROR_TYPE_MAP: Record<
  CompaniesHouseErrorType,
  { type: ProviderErrorType; retryable: boolean }
> = {
  invalid_company_number: { type: "validation_error", retryable: false },
  not_found: { type: "not_found", retryable: false },
  unauthorized: { type: "authentication_error", retryable: false },
  rate_limited: { type: "rate_limited", retryable: true },
  unavailable: { type: "provider_unavailable", retryable: true },
  timeout: { type: "network_error", retryable: true },
  malformed_response: { type: "malformed_response", retryable: false },
  network_error: { type: "network_error", retryable: true },
};

function missingApiKeyError(): ProviderError {
  return {
    type: "authentication_error",
    message: "COMPANIES_HOUSE_API_KEY is not configured.",
    retryable: false,
  };
}

export interface CompaniesHouseProviderOptions {
  /** Overrides process.env.COMPANIES_HOUSE_API_KEY — for tests only. */
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

/**
 * Build the Companies House ExternalVendorDataProvider.
 *
 * Reads the API key from process.env.COMPANIES_HOUSE_API_KEY by default.
 * `options.apiKey` exists only so tests can inject a fake key without
 * touching process.env; production callers should not pass it.
 */
export function createCompaniesHouseProvider(
  options: CompaniesHouseProviderOptions = {},
): ExternalVendorDataProvider<CompaniesHouseRawProfile, NormalisedCompanySnapshot> {
  const apiKey = options.apiKey ?? process.env["COMPANIES_HOUSE_API_KEY"];
  const { baseUrl, timeoutMs } = options;
  const now = options.now ?? (() => new Date());

  return {
    metadata: COMPANIES_HOUSE_METADATA,

    validateIdentifier(identifierValue: string): IdentifierValidationResult {
      const canonical = normaliseCompanyNumber(identifierValue);
      if (!canonical) {
        return {
          valid: false,
          reason: `"${identifierValue}" is not a valid Companies House company number.`,
        };
      }
      return { valid: true, normalizedValue: canonical };
    },

    async fetch(
      identifierValue: string,
      fetchOptions?: ProviderFetchOptions,
    ): Promise<ProviderFetchResult<CompaniesHouseRawProfile>> {
      if (!apiKey) {
        return { ok: false, error: missingApiKeyError() };
      }

      const result = await fetchCompanyProfile(identifierValue, {
        apiKey,
        baseUrl,
        timeoutMs: fetchOptions?.timeoutMs ?? timeoutMs,
        fetchImpl: fetchOptions?.fetchImpl,
      });

      if (!result.ok) {
        const mapped = ERROR_TYPE_MAP[result.errorType];
        const error: ProviderError = {
          type: mapped.type,
          message: result.message,
          retryable: mapped.retryable,
          httpStatus: result.httpStatus,
          retryAfterSeconds: result.retryAfterSeconds,
        };
        return { ok: false, error };
      }

      return { ok: true, raw: result.data, fetchedAt: now().toISOString() };
    },

    normalize(raw: CompaniesHouseRawProfile): NormalisedCompanySnapshot {
      return normaliseCompanyProfile(raw);
    },
  };
}
