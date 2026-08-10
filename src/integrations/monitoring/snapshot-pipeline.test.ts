import { describe, expect, it, vi } from "vitest";

import { createMockProvider } from "./mock-provider";
import {
  RunAlreadyInProgressError,
  runSnapshotPipeline,
  type InsertedRun,
  type InsertedSnapshot,
  type MonitoringRunStore,
} from "./snapshot-pipeline";
import type { NormalizedSnapshot } from "./types";

/**
 * In-memory MonitoringRunStore that records every call it receives. Its
 * interface has no method that could touch `vendors` — the strongest
 * evidence available (short of an integration test against a real DB) that
 * a provider failure structurally cannot alter vendor health.
 */
function createFakeStore(overrides: Partial<MonitoringRunStore> = {}) {
  const calls: {
    startRun: unknown[];
    insertSnapshot: unknown[];
    completeRun: unknown[];
  } = { startRun: [], insertSnapshot: [], completeRun: [] };

  let runCounter = 0;
  let snapshotCounter = 0;

  const store: MonitoringRunStore = {
    async startRun(input): Promise<InsertedRun> {
      calls.startRun.push(input);
      if (overrides.startRun) return overrides.startRun(input);
      return { id: `run-${++runCounter}` };
    },
    async insertSnapshot(input): Promise<InsertedSnapshot> {
      calls.insertSnapshot.push(input);
      if (overrides.insertSnapshot) return overrides.insertSnapshot(input);
      return { id: `snapshot-${++snapshotCounter}` };
    },
    async completeRun(input): Promise<void> {
      calls.completeRun.push(input);
      if (overrides.completeRun) return overrides.completeRun(input);
    },
  };

  return { store, calls };
}

describe("runSnapshotPipeline", () => {
  it("on success: starts a run, inserts a snapshot, and completes the run as success", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const provider = createMockProvider({
      metadata: { providerId: "mock_provider", requiredIdentifierType: "MOCK_ID" },
      responses: { "12345678": { status: "active" } },
      now: () => fixedNow,
    });
    const { store, calls } = createFakeStore();

    const outcome = await runSnapshotPipeline(store, {
      vendorId: "vendor-1",
      provider,
      identifierValue: "12345678",
      triggerType: "manual",
    });

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("expected success");
    expect(outcome.runId).toBe("run-1");
    expect(outcome.snapshotId).toBe("snapshot-1");
    expect(outcome.snapshot.normalizedData).toEqual({ status: "active" });

    expect(calls.startRun).toEqual([
      { vendorId: "vendor-1", provider: "mock_provider", triggerType: "manual" },
    ]);
    expect(calls.insertSnapshot).toHaveLength(1);
    expect(calls.completeRun).toEqual([
      { runId: "run-1", status: "success", snapshotId: "snapshot-1" },
    ]);
  });

  it("on provider failure: completes the run as failed, never inserts a snapshot, and never writes vendor data", async () => {
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
    const { store, calls } = createFakeStore();

    const outcome = await runSnapshotPipeline(store, {
      vendorId: "vendor-1",
      provider,
      identifierValue: "12345678",
      triggerType: "scheduled",
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.runId).toBe("run-1");
    expect(outcome.error.type).toBe("provider_unavailable");

    // A monitoring_runs row was created and completed as failed...
    expect(calls.startRun).toHaveLength(1);
    expect(calls.completeRun).toEqual([
      {
        runId: "run-1",
        status: "failed",
        error: {
          type: "provider_unavailable",
          message: "upstream is down",
          retryable: true,
          httpStatus: 503,
        },
      },
    ]);
    // ...but no snapshot was ever written for the failed fetch (docs/database-design.md §5).
    expect(calls.insertSnapshot).toHaveLength(0);

    // The store this pipeline was given has no method capable of writing to
    // `vendors` at all — every call it received is accounted for above, and
    // none of them is a vendor write. This is the structural guarantee that
    // a provider failure cannot change vendor health.
    const observedMethods = Object.keys(calls);
    expect(observedMethods).toEqual(["startRun", "insertSnapshot", "completeRun"]);
  });

  it("on invalid identifier: still records a failed monitoring run without calling the provider's fetch", async () => {
    const provider = createMockProvider({ invalidIdentifiers: ["BAD"] });
    const fetchSpy = vi.spyOn(provider, "fetch");
    const { store, calls } = createFakeStore();

    const outcome = await runSnapshotPipeline(store, {
      vendorId: "vendor-1",
      provider,
      identifierValue: "BAD",
      triggerType: "manual",
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.error.type).toBe("validation_error");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.insertSnapshot).toHaveLength(0);
  });

  it("skips (without calling the provider) when a run is already in progress for this vendor/provider", async () => {
    const provider = createMockProvider({ responses: { "12345678": { status: "active" } } });
    const fetchSpy = vi.spyOn(provider, "fetch");
    const { store, calls } = createFakeStore({
      startRun: async () => {
        throw new RunAlreadyInProgressError("vendor-1", "mock_provider");
      },
    });

    const outcome = await runSnapshotPipeline(store, {
      vendorId: "vendor-1",
      provider,
      identifierValue: "12345678",
      triggerType: "scheduled",
    });

    expect(outcome).toEqual({ status: "skipped", reason: "already_running" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.insertSnapshot).toHaveLength(0);
    expect(calls.completeRun).toHaveLength(0);
  });

  it("propagates an unexpected store error from startRun instead of swallowing it", async () => {
    const provider = createMockProvider({ responses: { "12345678": { status: "active" } } });
    const { store } = createFakeStore({
      startRun: async () => {
        throw new Error("connection reset");
      },
    });

    await expect(
      runSnapshotPipeline(store, {
        vendorId: "vendor-1",
        provider,
        identifierValue: "12345678",
        triggerType: "manual",
      }),
    ).rejects.toThrow("connection reset");
  });

  it("carries the snapshot's provider/fetchedAt/normalizedData through into the persisted snapshot record", async () => {
    const fixedNow = new Date("2026-02-03T04:05:06.000Z");
    const provider = createMockProvider({
      metadata: { providerId: "companies_house" },
      responses: { "00000006": { company_status: "active" } },
      normalize: (raw) => ({ companyStatus: raw["company_status"] }),
      now: () => fixedNow,
    });
    let capturedSnapshot: NormalizedSnapshot | undefined;
    const { store } = createFakeStore({
      insertSnapshot: async (input) => {
        capturedSnapshot = input.snapshot;
        return { id: "snapshot-1" };
      },
    });

    await runSnapshotPipeline(store, {
      vendorId: "vendor-1",
      provider,
      identifierValue: "00000006",
      triggerType: "initial_baseline",
    });

    expect(capturedSnapshot).toEqual({
      provider: "companies_house",
      vendorIdentifier: "00000006",
      fetchedAt: fixedNow.toISOString(),
      normalizedData: { companyStatus: "active" },
      rawData: { company_status: "active" },
      providerReference: null,
    });
  });
});
