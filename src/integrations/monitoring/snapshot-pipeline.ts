// Pure orchestration for the second half of the monitoring pipeline (ERD
// §3.2, docs/database-design.md §5/§6):
//
//   Fetch -> Validate -> Normalise -> Snapshot -> [monitoring run]
//
// `fetchNormalizedSnapshot` (./run-provider-fetch) already does
// Fetch/Validate/Normalise. This module is the piece that turns that result
// into durable rows: an `external_snapshots` row on success, and a
// `monitoring_runs` row either way — a snapshot is only ever written for a
// successful fetch (docs/database-design.md §5), and a run row is written
// for EVERY attempt, success or failure, so "the monitoring attempt failed"
// stays queryable independently of "the vendor's data changed".
//
// Deliberately never touches `vendors` in any way: the MonitoringRunStore
// interface below has no method that could write vendor health, so a
// provider failure structurally cannot alter it (docs/database-design.md
// §5 / ERD §3.4, §20).
//
// No Node/Supabase imports here — the Supabase-backed MonitoringRunStore
// lives in ./snapshot-pipeline.server.ts, following the client.ts /
// client.server.ts split used elsewhere in this codebase.

import { fetchNormalizedSnapshot } from "./run-provider-fetch";
import type {
  ExternalVendorDataProvider,
  NormalizedSnapshot,
  ProviderError,
  ProviderFetchOptions,
} from "./types";

export type TriggerType = "manual" | "scheduled" | "retry" | "initial_baseline";

export interface InsertedRun {
  id: string;
}

export interface InsertedSnapshot {
  id: string;
}

/**
 * Storage boundary for this half of the pipeline. Intentionally minimal —
 * three operations, none of which can reach `vendors` — so a fake
 * implementation in tests proves the "failure never touches vendor health"
 * requirement by construction, not just by assertion.
 */
export interface MonitoringRunStore {
  /**
   * Insert a `monitoring_runs` row with `status = 'running'`. Must reject
   * (throw `RunAlreadyInProgressError`) if a run is already in flight for
   * this vendor/provider — the DB-level unique partial index is the source
   * of truth (docs/database-design.md §6, ERD §24); this is just the typed
   * boundary a real Supabase-backed store maps its unique-violation onto.
   */
  startRun(input: {
    vendorId: string;
    provider: string;
    triggerType: TriggerType;
  }): Promise<InsertedRun>;

  /** Insert an `external_snapshots` row. Only ever called on a successful fetch. */
  insertSnapshot(input: {
    vendorId: string;
    snapshot: NormalizedSnapshot;
    fetchStatus: "success" | "partial";
  }): Promise<InsertedSnapshot>;

  /** Move a run to a terminal status. Never writes anything to `vendors`. */
  completeRun(
    input:
      | { runId: string; status: "success" | "partial"; snapshotId: string }
      | { runId: string; status: "failed"; error: ProviderError },
  ): Promise<void>;
}

/** Thrown by a MonitoringRunStore.startRun implementation when a run is already in flight. */
export class RunAlreadyInProgressError extends Error {
  constructor(vendorId: string, provider: string) {
    super(`A monitoring run is already in progress for vendor ${vendorId} / provider ${provider}.`);
    this.name = "RunAlreadyInProgressError";
  }
}

export interface RunSnapshotPipelineInput<RawData, NormalizedData> {
  vendorId: string;
  provider: ExternalVendorDataProvider<RawData, NormalizedData>;
  identifierValue: string;
  triggerType: TriggerType;
  fetchOptions?: ProviderFetchOptions | undefined;
}

export type SnapshotPipelineOutcome =
  | { status: "success"; runId: string; snapshotId: string; snapshot: NormalizedSnapshot }
  | { status: "failed"; runId: string; error: ProviderError }
  | { status: "skipped"; reason: "already_running" };

/**
 * Run one vendor/provider check end to end and persist the outcome:
 *
 *   start monitoring_run (running)
 *     -> fetch/validate/normalize via the provider
 *     -> success: insert external_snapshots row, complete run as success
 *     -> failure: complete run as failed (no snapshot, vendors untouched)
 *
 * Never throws for an expected failure mode (provider errors, an in-flight
 * run) — every outcome is a typed result, mirroring the provider contract.
 */
export async function runSnapshotPipeline<RawData, NormalizedData>(
  store: MonitoringRunStore,
  input: RunSnapshotPipelineInput<RawData, NormalizedData>,
): Promise<SnapshotPipelineOutcome> {
  let run: InsertedRun;
  try {
    run = await store.startRun({
      vendorId: input.vendorId,
      provider: input.provider.metadata.providerId,
      triggerType: input.triggerType,
    });
  } catch (err) {
    if (err instanceof RunAlreadyInProgressError) {
      return { status: "skipped", reason: "already_running" };
    }
    throw err;
  }

  const fetchResult = await fetchNormalizedSnapshot(
    input.provider,
    input.identifierValue,
    input.fetchOptions,
  );

  if (!fetchResult.ok) {
    await store.completeRun({ runId: run.id, status: "failed", error: fetchResult.error });
    return { status: "failed", runId: run.id, error: fetchResult.error };
  }

  // Widened to the storage-facing NormalizedSnapshot shape: normalizedData
  // only needs to be jsonb-serializable from here on, not the provider's
  // specific NormalizedData type.
  const snapshot = fetchResult.snapshot as NormalizedSnapshot;

  const inserted = await store.insertSnapshot({
    vendorId: input.vendorId,
    snapshot,
    fetchStatus: "success",
  });

  await store.completeRun({ runId: run.id, status: "success", snapshotId: inserted.id });

  return {
    status: "success",
    runId: run.id,
    snapshotId: inserted.id,
    snapshot,
  };
}
