import { describe, expect, it, vi } from "vitest";

import { runScheduledBatch, type EligibleVendor, type SchedulerStore } from "./scheduler";
import type { CheckOutcome } from "./monitor";

const vendors: EligibleVendor[] = [
  { vendorId: "one", companyNumber: "00000001" },
  { vendorId: "two", companyNumber: "00000002" },
];

function ok(): CheckOutcome {
  return {
    status: "ok",
    snapshot: {
      companyNumber: "00000001",
      companyName: "Test",
      companyStatus: "active",
      companyType: "ltd",
      registeredOfficeAddress: null,
      dateOfCreation: null,
      jurisdiction: null,
      accountsNextDue: null,
      accountsStatus: null,
      confirmationStatementNextDue: null,
      confirmationStatementStatus: null,
      sicCodes: [],
    },
    changes: [],
    alertsCreated: 0,
    eventsCreated: 0,
    isBaseline: false,
  };
}

function fakeStore(overrides: Partial<SchedulerStore> = {}) {
  const completed: Array<CheckOutcome | Error> = [];
  const store: SchedulerStore = {
    acquireLease: async () => true,
    releaseLease: async () => undefined,
    recoverStaleRuns: async () => undefined,
    getEligibleVendors: async () => vendors,
    beginRun: async (vendor) => `run-${vendor.vendorId}`,
    finishRun: async (_id, outcome) => {
      completed.push(outcome);
    },
    markChecked: async () => undefined,
    ...overrides,
  };
  return { store, completed };
}

describe("runScheduledBatch", () => {
  it("skips an overlapping scheduler execution", async () => {
    const runCheck = vi.fn(async () => ok());
    const { store } = fakeStore({ acquireLease: async () => false });
    expect(await runScheduledBatch({ store, runCheck })).toMatchObject({
      status: "overlap_skipped",
    });
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("recovers abandoned runs before claiming eligible vendors", async () => {
    const calls: string[] = [];
    const { store } = fakeStore({
      recoverStaleRuns: async () => {
        calls.push("recover");
      },
      getEligibleVendors: async () => {
        calls.push("eligible");
        return [];
      },
    });
    await runScheduledBatch({ store, runCheck: async () => ok() });
    expect(calls).toEqual(["recover", "eligible"]);
  });

  it("batches eligible vendors and isolates per-vendor exceptions", async () => {
    const { store, completed } = fakeStore();
    const result = await runScheduledBatch(
      {
        store,
        runCheck: async (vendor) =>
          vendor.vendorId === "one" ? Promise.reject(new Error("boom")) : ok(),
        sleep: async () => undefined,
      },
      { batchSize: 2 },
    );
    expect(result).toEqual({
      status: "completed",
      eligible: 2,
      succeeded: 1,
      failed: 1,
      skipped: 0,
    });
    expect(completed).toHaveLength(2);
    expect(completed[0]).toBeInstanceOf(Error);
    expect(completed[1]).toMatchObject({ status: "ok" });
  });

  it("skips a vendor that already has a running monitoring run", async () => {
    const { store } = fakeStore({
      beginRun: async (vendor) => (vendor.vendorId === "one" ? null : "run-two"),
    });
    const runCheck = vi.fn(async () => ok());
    const result = await runScheduledBatch(
      { store, runCheck, sleep: async () => undefined },
      { minimumRequestIntervalMs: 0 },
    );
    expect(result).toMatchObject({ succeeded: 1, skipped: 1 });
    expect(runCheck).toHaveBeenCalledOnce();
  });

  it("stops claiming vendors if the batch lease cannot be renewed", async () => {
    let leaseAttempt = 0;
    const { store } = fakeStore({
      acquireLease: async () => {
        leaseAttempt += 1;
        return leaseAttempt === 1;
      },
    });
    const runCheck = vi.fn(async () => ok());
    const result = await runScheduledBatch(
      { store, runCheck, sleep: async () => undefined },
      { minimumRequestIntervalMs: 0 },
    );
    expect(runCheck).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ succeeded: 1, skipped: 1 });
  });

  it("backs off on 429 and succeeds on retry", async () => {
    const { store } = fakeStore({ getEligibleVendors: async () => [vendors[0]!] });
    const sleep = vi.fn(async () => undefined);
    const runCheck = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failed",
        errorType: "rate_limited",
        message: "429",
        retryAfterSeconds: 7,
      })
      .mockResolvedValueOnce(ok());
    const result = await runScheduledBatch(
      { store, runCheck, sleep },
      { minimumRequestIntervalMs: 0 },
    );
    expect(result.succeeded).toBe(1);
    expect(runCheck).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7_000);
  });

  it("does not hold the worker open for an excessive Retry-After", async () => {
    const { store } = fakeStore({ getEligibleVendors: async () => [vendors[0]!] });
    const sleep = vi.fn(async () => undefined);
    const runCheck = vi.fn(async () => ({
      status: "failed" as const,
      errorType: "rate_limited",
      message: "429",
      retryAfterSeconds: 3_600,
    }));
    const result = await runScheduledBatch(
      { store, runCheck, sleep },
      { minimumRequestIntervalMs: 0 },
    );
    expect(result.failed).toBe(1);
    expect(runCheck).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient failures but not permanent failures", async () => {
    const { store } = fakeStore();
    const attempts = new Map<string, number>();
    await runScheduledBatch({
      store,
      sleep: async () => undefined,
      runCheck: async (vendor) => {
        const attempt = (attempts.get(vendor.vendorId) ?? 0) + 1;
        attempts.set(vendor.vendorId, attempt);
        return vendor.vendorId === "one"
          ? { status: "failed", errorType: "timeout", message: "timeout" }
          : { status: "failed", errorType: "not_found", message: "missing" };
      },
    });
    expect(attempts.get("one")).toBe(3);
    expect(attempts.get("two")).toBe(1);
  });
});
