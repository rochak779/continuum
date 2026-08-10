// Generic orchestration for the Fetch -> Validate -> Normalise -> Snapshot
// half of the monitoring pipeline (ERD §3.2), driven entirely by the
// ExternalVendorDataProvider contract. This is the only place the monitoring
// engine should call into a provider — it never needs to know how a specific
// provider authenticates or shapes its response (ERD §15).
//
// Pure orchestration, no I/O of its own — the provider does the network
// call, this function just sequences validate -> fetch -> normalize and
// shapes the result into a NormalizedSnapshot.

import type {
  ExternalVendorDataProvider,
  ProviderFetchOptions,
  ProviderSnapshotResult,
} from "./types";

/**
 * Run one provider fetch for a vendor identifier, end to end:
 * validate the identifier, fetch from the provider, normalize the raw
 * response, and assemble a NormalizedSnapshot ready to persist as an
 * external_snapshots row. Never throws — every outcome is a typed result.
 */
export async function fetchNormalizedSnapshot<RawData, NormalizedData>(
  provider: ExternalVendorDataProvider<RawData, NormalizedData>,
  identifierValue: string,
  options?: ProviderFetchOptions,
): Promise<ProviderSnapshotResult<NormalizedData>> {
  const validation = provider.validateIdentifier(identifierValue);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        type: "validation_error",
        message: validation.reason,
        retryable: false,
      },
    };
  }

  const fetchResult = await provider.fetch(validation.normalizedValue, options);
  if (!fetchResult.ok) {
    return { ok: false, error: fetchResult.error };
  }

  const normalizedData = provider.normalize(fetchResult.raw);

  return {
    ok: true,
    snapshot: {
      provider: provider.metadata.providerId,
      vendorIdentifier: validation.normalizedValue,
      fetchedAt: fetchResult.fetchedAt,
      normalizedData,
      rawData: fetchResult.raw,
      providerReference: fetchResult.providerReference ?? null,
    },
  };
}
