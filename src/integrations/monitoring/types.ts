// Provider-independent external monitoring framework.
//
// Every external data source (Companies House, GST, sanctions, MCA, ...)
// implements ExternalVendorDataProvider below. The monitoring engine talks
// only to this interface, never to a provider's own API shape, so adding a
// new provider never requires rewriting the engine (ERD §3.2, §15):
//
//   Fetch -> Validate -> Normalise -> Snapshot -> Compare -> Classify -> Alert
//
// This file defines the "Fetch -> Validate -> Normalise -> Snapshot" half of
// that pipeline, generically. Compare/Classify/Alert operate on the
// NormalizedSnapshot this produces and don't need to know which provider
// produced it.
//
// Keep this file free of Node/Supabase imports so it can be used from both
// server code and unit tests without pulling in a runtime.

/** Stable identifier for a provider, e.g. "companies_house", "gst", "sanctions". */
export type ProviderId = string;

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

/**
 * Static facts about a provider, independent of any single fetch. Drives
 * which providers are even applicable to a given vendor (matching country /
 * identifier type) before a network call is attempted (ERD §15).
 */
export interface ProviderMetadata {
  providerId: ProviderId;
  displayName: string;
  /** ISO 3166-1 alpha-2 codes this provider can monitor, or "any" for global providers. */
  supportedCountryCodes: readonly string[] | "any";
  /** The vendor_identifiers.identifier_type this provider consumes, e.g. "COMPANIES_HOUSE_NUMBER". */
  requiredIdentifierType: string;
}

// ---------------------------------------------------------------------------
// Identifier validation
// ---------------------------------------------------------------------------

export type IdentifierValidationResult =
  { valid: true; normalizedValue: string } | { valid: false; reason: string };

// ---------------------------------------------------------------------------
// Normalized errors — every provider maps its own failure modes onto this
// fixed vocabulary (ERD §25) so the monitoring engine can apply one retry /
// alerting policy (ERD §26) regardless of which provider failed.
// ---------------------------------------------------------------------------

export type ProviderErrorType =
  | "validation_error"
  | "authentication_error"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "network_error"
  | "malformed_response"
  | "unknown_error";

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  httpStatus?: number | undefined;
  retryAfterSeconds?: number | undefined;
  /** Whether the monitoring engine should retry this failure (ERD §26). */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Provider fetch — the raw, provider-shaped result of one network call.
// ---------------------------------------------------------------------------

export interface ProviderFetchOptions {
  timeoutMs?: number | undefined;
  // Injectable for tests; defaults to global fetch inside a real provider.
  fetchImpl?: typeof fetch | undefined;
}

export type ProviderFetchResult<RawData> =
  | { ok: true; raw: RawData; fetchedAt: string; providerReference?: string | undefined }
  | { ok: false; error: ProviderError };

// ---------------------------------------------------------------------------
// Normalized snapshots — the shape every provider's output is reduced to,
// mirroring external_snapshots (docs/database-design.md §5 / ERD §9).
// ---------------------------------------------------------------------------

export interface NormalizedSnapshot<NormalizedData = Record<string, unknown>> {
  provider: ProviderId;
  vendorIdentifier: string;
  fetchedAt: string;
  normalizedData: NormalizedData;
  rawData: unknown;
  providerReference?: string | null;
}

export type ProviderSnapshotResult<NormalizedData = Record<string, unknown>> =
  { ok: true; snapshot: NormalizedSnapshot<NormalizedData> } | { ok: false; error: ProviderError };

// ---------------------------------------------------------------------------
// The provider contract itself (ERD §15): "Each provider must support
// Provider ID, Supported country, Required identifier, Identifier
// validation, Fetch, Normalisation, Error mapping."
// ---------------------------------------------------------------------------

export interface ExternalVendorDataProvider<
  RawData = unknown,
  NormalizedData = Record<string, unknown>,
> {
  readonly metadata: ProviderMetadata;

  /** Validate (and normalize the format of) a raw identifier value before any network call. */
  validateIdentifier(identifierValue: string): IdentifierValidationResult;

  /**
   * Fetch this vendor's current data from the provider. Must never throw for
   * an expected failure mode — every outcome, success or failure, is
   * returned as a typed result so callers handle each case explicitly
   * (mirrors the pattern proven in the Companies House client).
   */
  fetch(
    identifierValue: string,
    options?: ProviderFetchOptions,
  ): Promise<ProviderFetchResult<RawData>>;

  /** Pure transform from the provider's raw shape to Continuum's normalized shape. No I/O. */
  normalize(raw: RawData): NormalizedData;
}
