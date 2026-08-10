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
    recordAuditEvent: unknown[];
  } = { startRun: [], insertSnapshot: [], completeRun: [], recordAuditEvent: [] };

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
    async recordAuditEvent(input): Promise<void> {
      calls.recordAuditEvent.push(input);
      if (overrides.recordAuditEvent) return overrides.recordAuditEvent(input);
    },
  };

  return { store, calls };
}

const BASE_INPUT = { organisationId: "org-1", vendorId: "vendor-1" };

describe("runSnapshotPipeline", () => {
  it("on success: starts a run, inserts a snapshot, completes the run as success, and audits monitoring_started only", async () => {
    const fixedNow = new Date("2026-01-01T00:00:00.000Z");
    const provider = createMockProvider({
      metadata: { providerId: "mock_provider", requiredIdentifierType: "MOCK_ID" },
      responses: { "12345678": { status: "active" } },
      now: () => fixedNow,
    });
    const { store, calls } = createFakeStore();

    const outcome = await runSnapshotPipeline(store, {
      ...BASE_INPUT,
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

    // A non-baseline successful run only ever audits the attempt starting —
    // baseline_created is reserved for triggerType === "initial_baseline".
    expect(calls.recordAuditEvent).toHaveLength(1);
    expect(calls.recordAuditEvent[0]).toMatchObject({
      organisationId: "org-1",
      vendorId: "vendor-1",
      eventType: "monitoring_started",
      entityType: "monitoring_run",
      entityId: "run-1",
    });
  });

  it("on provider failure: completes the run as failed, never inserts a snapshot, and audits monitoring_started then monitoring_failed", async () => {
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
      ...BASE_INPUT,
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
    expect(observedMethods).toEqual([
      "startRun",
      "insertSnapshot",
      "completeRun",
      "recordAuditEvent",
    ]);

    // Audited exactly twice: the attempt starting, then the failure — never
    // a baseline_created, no matter what triggerType was.
    expect(calls.recordAuditEvent).toHaveLength(2);
    expect(calls.recordAuditEvent[0]).toMatchObject({ eventType: "monitoring_started" });
    expect(calls.recordAuditEvent[1]).toMatchObject({
      organisationId: "org-1",
      vendorId: "vendor-1",
      eventType: "monitoring_failed",
      entityType: "monitoring_run",
      entityId: "run-1",
      metadata: expect.objectContaining({ errorType: "provider_unavailable" }),
    });
  });

  it("on invalid identifier: still records a failed monitoring run and a monitoring_failed audit event, without calling the provider's fetch", async () => {
    const provider = createMockProvider({ invalidIdentifiers: ["BAD"] });
    const fetchSpy = vi.spyOn(provider, "fetch");
    const { store, calls } = createFakeStore();

    const outcome = await runSnapshotPipeline(store, {
      ...BASE_INPUT,
      provider,
      identifierValue: "BAD",
      triggerType: "manual",
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("expected failed");
    expect(outcome.error.type).toBe("validation_error");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.insertSnapshot).toHaveLength(0);
    expect(calls.recordAuditEvent.map((c) => (c as { eventType: string }).eventType)).toEqual([
      "monitoring_started",
      "monitoring_failed",
    ]);
  });

  it("skips (without calling the provider or writing any audit event) when a run is already in progress for this vendor/provider", async () => {
    const provider = createMockProvider({ responses: { "12345678": { status: "active" } } });
    const fetchSpy = vi.spyOn(provider, "fetch");
    const { store, calls } = createFakeStore({
      startRun: async () => {
        throw new RunAlreadyInProgressError("vendor-1", "mock_provider");
      },
    });

    const outcome = await runSnapshotPipeline(store, {
      ...BASE_INPUT,
      provider,
      identifierValue: "12345678",
      triggerType: "scheduled",
    });

    expect(outcome).toEqual({ status: "skipped", reason: "already_running" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(calls.insertSnapshot).toHaveLength(0);
    expect(calls.completeRun).toHaveLength(0);
    expect(calls.recordAuditEvent).toHaveLength(0);
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
        ...BASE_INPUT,
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
      ...BASE_INPUT,
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

  describe("audit trail (ERD §13)", () => {
    it("audits baseline_created (in addition to monitoring_started) when triggerType is initial_baseline and the fetch succeeds", async () => {
      const provider = createMockProvider({
        responses: { "12345678": { status: "active" } },
      });
      const { store, calls } = createFakeStore();

      await runSnapshotPipeline(store, {
        ...BASE_INPUT,
        provider,
        identifierValue: "12345678",
        triggerType: "initial_baseline",
      });

      const eventTypes = calls.recordAuditEvent.map((c) => (c as { eventType: string }).eventType);
      expect(eventTypes).toEqual(["monitoring_started", "baseline_created"]);

      const baselineEvent = calls.recordAuditEvent[1] as {
        entityType: string;
        entityId: string;
        organisationId: string;
        vendorId: string;
      };
      expect(baselineEvent.entityType).toBe("external_snapshots");
      expect(baselineEvent.entityId).toBe("snapshot-1");
      expect(baselineEvent.organisationId).toBe("org-1");
      expect(baselineEvent.vendorId).toBe("vendor-1");
    });

    it("does NOT audit baseline_created for a successful non-baseline run (manual/scheduled/retry)", async () => {
      for (const triggerType of ["manual", "scheduled", "retry"] as const) {
        const provider = createMockProvider({ responses: { "12345678": { status: "active" } } });
        const { store, calls } = createFakeStore();

        await runSnapshotPipeline(store, {
          ...BASE_INPUT,
          provider,
          identifierValue: "12345678",
          triggerType,
        });

        const eventTypes = calls.recordAuditEvent.map(
          (c) => (c as { eventType: string }).eventType,
        );
        expect(eventTypes).toEqual(["monitoring_started"]);
      }
    });

    it("does NOT audit baseline_created for a FAILED initial_baseline run", async () => {
      const provider = createMockProvider({ invalidIdentifiers: ["BAD"] });
      const { store, calls } = createFakeStore();

      await runSnapshotPipeline(store, {
        ...BASE_INPUT,
        provider,
        identifierValue: "BAD",
        triggerType: "initial_baseline",
      });

      const eventTypes = calls.recordAuditEvent.map((c) => (c as { eventType: string }).eventType);
      expect(eventTypes).toEqual(["monitoring_started", "monitoring_failed"]);
    });

    it("defaults the audit actor to a system actor when none is supplied", async () => {
      const provider = createMockProvider({ responses: { "12345678": { status: "active" } } });
      const { store, calls } = createFakeStore();

      await runSnapshotPipeline(store, {
        ...BASE_INPUT,
        provider,
        identifierValue: "12345678",
        triggerType: "manual",
      });

      expect(calls.recordAuditEvent[0]).toMatchObject({ actor: { id: null, type: "system" } });
    });

    it("threads a supplied actor through to every audit event the run produces", async () => {
      const provider = createMockProvider({
        responses: {
          "12345678": {
            type: "provider_unavailable",
            message: "down",
            retryable: true,
          },
        },
      });
      const { store, calls } = createFakeStore();
      const actor = { id: "user-9", type: "user" as const };

      await runSnapshotPipeline(store, {
        ...BASE_INPUT,
        provider,
        identifierValue: "12345678",
        triggerType: "manual",
        actor,
      });

      for (const call of calls.recordAuditEvent) {
        expect((call as { actor: unknown }).actor).toEqual(actor);
      }
    });
  });
});
