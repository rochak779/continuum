import { describe, expect, it, vi } from "vitest";

import {
  runCompaniesHouseCheck,
  type AlertRecord,
  type ChangeEventRecord,
  type FailureRecord,
  type MonitoringStore,
  type PersistedAlert,
  type SnapshotRecord,
  type TrustProfileAttributeRecord,
} from "./monitor";
import { verifyMonitoringAlert, type AlertResolutionStore } from "./resolution";
import { runScheduledBatch, type SchedulerStore } from "./scheduler";
import type { CompaniesHouseResult, JsonValue } from "./types";

interface StoredEvent extends ChangeEventRecord {
  id: string;
  status: "open" | "resolved";
}

interface StoredAlert extends AlertRecord {
  id: string;
  status: "open" | "resolved";
}

function profile(status = "active"): CompaniesHouseResult {
  return {
    ok: true,
    data: {
      company_number: "00000006",
      company_name: "ACME LTD",
      company_status: status,
      type: "ltd",
      sic_codes: ["62012"],
      registered_office_address: { address_line_1: "1 High Street" },
    },
  };
}

function lifecycleStore() {
  const owners = new Map([
    ["vendor-a", "tenant-a"],
    ["vendor-b", "tenant-b"],
  ]);
  const snapshots: Array<SnapshotRecord & { vendorId: string; id: string }> = [];
  const trust = new Map<string, Map<string, TrustProfileAttributeRecord>>();
  const events: StoredEvent[] = [];
  const alerts: StoredAlert[] = [];
  const failures: FailureRecord[] = [];

  const monitoring: MonitoringStore = {
    async getTrustProfile(vendorId) {
      return Object.fromEntries(
        [...(trust.get(vendorId)?.values() ?? [])].map((attribute) => [
          attribute.attributeKey,
          attribute.currentValue,
        ]),
      );
    },
    async insertSnapshot(record) {
      const id = `snapshot-${snapshots.length + 1}`;
      snapshots.push({ ...record, id });
      return id;
    },
    async createTrustBaseline(records) {
      for (const record of records) {
        const attributes = trust.get(record.vendorId) ?? new Map();
        if (!attributes.has(record.attributeKey)) attributes.set(record.attributeKey, record);
        trust.set(record.vendorId, attributes);
      }
    },
    async insertChangeEvents(records) {
      let inserted = 0;
      for (const record of records) {
        if (events.some((event) => event.dedupeKey === record.dedupeKey)) continue;
        events.push({ ...record, id: `event-${events.length + 1}`, status: "open" });
        inserted += 1;
      }
      return {
        inserted,
        events: records.map((record) => {
          const persisted = events.find((event) => event.dedupeKey === record.dedupeKey)!;
          return { ...record, id: persisted.id };
        }),
      };
    },
    async insertAlerts(records) {
      const inserted: PersistedAlert[] = [];
      for (const record of records) {
        if (alerts.some((alert) => alert.changeEventId === record.changeEventId)) continue;
        const persisted: StoredAlert = { ...record, id: `alert-${alerts.length + 1}`, status: "open" };
        alerts.push(persisted);
        inserted.push(persisted);
      }
      return { inserted };
    },
    async notifyCriticalAlerts() {
      // no-op: this test file focuses on the alert lifecycle, not notification delivery
    },
    async recordFailure(record) {
      failures.push(record);
    },
    async setMonitoringStatus() {},
  };

  const resolution: AlertResolutionStore = {
    async verifyAlert(alertId, actorId, verifiedAt) {
      const alert = alerts.find((candidate) => candidate.id === alertId);
      if (!alert || alert.status === "resolved" || owners.get(alert.vendorId) !== actorId) {
        return false;
      }
      const event = events.find((candidate) => candidate.id === alert.changeEventId);
      if (!event) return false;
      const attributes = trust.get(alert.vendorId)!;
      attributes.set(event.attribute, {
        vendorId: alert.vendorId,
        attributeKey: event.attribute,
        currentValue: event.newValue,
        source: event.source,
        verifiedAt,
      });
      alert.status = "resolved";
      event.status = "resolved";
      return true;
    },
  };

  return {
    monitoring,
    resolution,
    snapshots,
    trust,
    events,
    alerts,
    failures,
    visibleAlerts: (actorId: string) =>
      alerts.filter((alert) => owners.get(alert.vendorId) === actorId),
  };
}

describe("complete vendor monitoring lifecycle", () => {
  it("establishes, detects, alerts and verifies while preserving evidence", async () => {
    const state = lifecycleStore();
    const params = { vendorId: "vendor-a", companyNumber: "00000006" };

    const baseline = await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile("active"),
    });
    expect(baseline).toMatchObject({ status: "ok", isBaseline: true, alertsCreated: 0 });
    expect(state.snapshots).toHaveLength(1);
    expect(state.trust.get("vendor-a")?.get("company_status")?.currentValue).toBe("active");

    const unchanged = await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile("active"),
    });
    expect(unchanged).toMatchObject({ status: "ok", eventsCreated: 0, alertsCreated: 0 });

    const liquidation = await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile("liquidation"),
    });
    expect(liquidation).toMatchObject({ status: "ok", eventsCreated: 1, alertsCreated: 1 });
    expect(state.events[0]).toMatchObject({
      attribute: "company_status",
      previousValue: "active",
      newValue: "liquidation",
      severity: "critical",
      snapshotId: "snapshot-3",
    });
    expect(state.alerts[0]).toMatchObject({
      severity: "critical",
      changeEventId: state.events[0]?.id,
      snapshotId: "snapshot-3",
      status: "open",
    });

    await expect(
      verifyMonitoringAlert(
        { alertId: state.alerts[0]!.id, actorId: "tenant-b" },
        state.resolution,
      ),
    ).rejects.toThrow("not available");
    expect(state.trust.get("vendor-a")?.get("company_status")?.currentValue).toBe("active");

    await verifyMonitoringAlert(
      { alertId: state.alerts[0]!.id, actorId: "tenant-a" },
      state.resolution,
      () => new Date("2026-08-10T18:00:00.000Z"),
    );
    expect(state.trust.get("vendor-a")?.get("company_status")).toMatchObject({
      currentValue: "liquidation",
      verifiedAt: "2026-08-10T18:00:00.000Z",
    });
    expect(state.alerts[0]?.status).toBe("resolved");
    expect(state.events[0]?.status).toBe("resolved");
    expect(state.events[0]?.previousValue).toBe("active");
  });

  it("prevents duplicate events and alerts for repeated identical evidence", async () => {
    const state = lifecycleStore();
    const params = { vendorId: "vendor-a", companyNumber: "00000006" };
    await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile(),
    });
    await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile("liquidation"),
    });
    const retry = await runCompaniesHouseCheck(params, {
      store: state.monitoring,
      fetchProfile: async () => profile("liquidation"),
    });
    expect(retry).toMatchObject({ status: "ok", eventsCreated: 0, alertsCreated: 0 });
    expect(state.events).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
  });

  it("records provider failure without mutating evidence or another tenant", async () => {
    const state = lifecycleStore();
    const result = await runCompaniesHouseCheck(
      { vendorId: "vendor-b", companyNumber: "00000007" },
      {
        store: state.monitoring,
        fetchProfile: async () => ({
          ok: false,
          errorType: "unavailable",
          message: "provider down",
          httpStatus: 503,
        }),
      },
    );
    expect(result).toMatchObject({ status: "failed", errorType: "unavailable" });
    expect(state.failures).toHaveLength(1);
    expect(state.snapshots).toHaveLength(0);
    expect(state.trust.has("vendor-b")).toBe(false);
    expect(state.visibleAlerts("tenant-a")).toEqual([]);
    expect(state.visibleAlerts("tenant-b")).toEqual([]);
  });

  it("retries a transient provider failure in scheduled monitoring", async () => {
    const runCheck = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed", errorType: "timeout", message: "timeout" })
      .mockResolvedValueOnce({ status: "failed", errorType: "unavailable", message: "503" })
      .mockResolvedValueOnce({
        status: "ok",
        snapshot: {},
        changes: [],
        alertsCreated: 0,
        eventsCreated: 0,
        isBaseline: false,
      });
    const scheduler: SchedulerStore = {
      acquireLease: async () => true,
      releaseLease: async () => undefined,
      recoverStaleRuns: async () => undefined,
      getEligibleVendors: async () => [{ vendorId: "vendor-a", companyNumber: "00000006" }],
      beginRun: async () => "run-1",
      finishRun: async () => undefined,
      markChecked: async () => undefined,
    };
    const summary = await runScheduledBatch(
      { store: scheduler, runCheck, sleep: async () => undefined },
      { minimumRequestIntervalMs: 0 },
    );
    expect(runCheck).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ succeeded: 1, failed: 0 });
  });
});
