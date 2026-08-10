// A fully in-memory ExternalVendorDataProvider for exercising the monitoring
// framework — and, later, the monitoring engine — without any real network
// dependency or a specific provider (Companies House is not implemented
// here on purpose). Configure canned responses per identifier value and use
// it in tests exactly as a real provider would be used.

import type {
  ExternalVendorDataProvider,
  IdentifierValidationResult,
  ProviderError,
  ProviderFetchResult,
  ProviderMetadata,
} from "./types";

export type MockProviderRawData = Record<string, unknown>;

export interface MockProviderConfig {
  metadata?: Partial<ProviderMetadata> | undefined;
  /** identifierValue -> canned raw response, or a ProviderError to fail with. */
  responses?: Record<string, MockProviderRawData | ProviderError> | undefined;
  /** Identifier values that validateIdentifier should reject. */
  invalidIdentifiers?: string[] | undefined;
  /** Pure raw -> normalized transform; defaults to a shallow copy (identity). */
  normalize?: ((raw: MockProviderRawData) => Record<string, unknown>) | undefined;
  now?: (() => Date) | undefined;
}

const DEFAULT_METADATA: ProviderMetadata = {
  providerId: "mock_provider",
  displayName: "Mock Provider",
  supportedCountryCodes: "any",
  requiredIdentifierType: "MOCK_ID",
};

function isProviderError(value: MockProviderRawData | ProviderError): value is ProviderError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "retryable" in value &&
    "message" in value
  );
}

/**
 * Create a mock provider. With no configuration it validates any non-empty
 * identifier and fails every fetch with `not_found` (nothing configured) —
 * tests opt into specific behaviour via `responses` / `invalidIdentifiers`.
 */
export function createMockProvider(
  config: MockProviderConfig = {},
): ExternalVendorDataProvider<MockProviderRawData, Record<string, unknown>> {
  const metadata: ProviderMetadata = { ...DEFAULT_METADATA, ...config.metadata };
  const responses = config.responses ?? {};
  const invalidIdentifiers = new Set(config.invalidIdentifiers ?? []);
  const normalize = config.normalize ?? ((raw: MockProviderRawData) => ({ ...raw }));
  const now = config.now ?? (() => new Date());

  return {
    metadata,

    validateIdentifier(identifierValue: string): IdentifierValidationResult {
      const trimmed = identifierValue.trim();
      if (trimmed.length === 0 || invalidIdentifiers.has(trimmed)) {
        return {
          valid: false,
          reason: `"${identifierValue}" is not a valid ${metadata.requiredIdentifierType}.`,
        };
      }
      return { valid: true, normalizedValue: trimmed };
    },

    async fetch(identifierValue): Promise<ProviderFetchResult<MockProviderRawData>> {
      const canned = responses[identifierValue];
      if (canned === undefined) {
        return {
          ok: false,
          error: {
            type: "not_found",
            message: `No mock response configured for "${identifierValue}".`,
            retryable: false,
          },
        };
      }
      if (isProviderError(canned)) {
        return { ok: false, error: canned };
      }
      return { ok: true, raw: canned, fetchedAt: now().toISOString() };
    },

    normalize,
  };
}
