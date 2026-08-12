import { describe, expect, it, vi } from "vitest";

import { createSupabaseMonitoringStore } from "./monitor.server";
import type { AlertRecord, PersistedAlert } from "./monitor";

const { notifyCriticalAlertsForVendor } = vi.hoisted(() => ({
  notifyCriticalAlertsForVendor: vi.fn(),
}));

vi.mock("../notifications/notify-critical-alerts.server", () => ({
  notifyCriticalAlertsForVendor,
}));

// A minimal fake covering only what insertAlerts touches:
// db.from("vendor_monitoring_alerts").upsert(...).select("id,dedupe_key")
// resolves to { data, error }.
function fakeDbForUpsert(rows: { id: string; dedupe_key: string }[]) {
  const upsertCalls: unknown[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe("vendor_monitoring_alerts");
      return {
        upsert: (records: unknown) => {
          upsertCalls.push(records);
          return {
            select: (columns: string) => {
              expect(columns).toBe("id,dedupe_key");
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Parameters<typeof createSupabaseMonitoringStore>[0], upsertCalls };
}

function buildAlertRecord(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    vendorId: "vendor-1",
    changeEventId: "change-1",
    snapshotId: "snapshot-1",
    source: "companies_house",
    attribute: "companyStatus",
    previousValue: "active",
    newValue: "dissolved",
    severity: "critical",
    checkedAt: "2026-08-12T00:00:00.000Z",
    dedupeKey: "dedupe-1",
    ...overrides,
  };
}

describe("createSupabaseMonitoringStore insertAlerts", () => {
  it("maps returned {id, dedupe_key} rows back to full PersistedAlert objects", async () => {
    const record = buildAlertRecord();
    const { db } = fakeDbForUpsert([{ id: "alert-1", dedupe_key: "dedupe-1" }]);
    const store = createSupabaseMonitoringStore(db);

    const { inserted } = await store.insertAlerts([record]);

    expect(inserted).toEqual([{ ...record, id: "alert-1" }]);
  });

  it("omits input records that were duplicates (ignoreDuplicates -> fewer returned rows)", async () => {
    const newRecord = buildAlertRecord({ dedupeKey: "dedupe-new", changeEventId: "change-new" });
    const duplicateRecord = buildAlertRecord({ dedupeKey: "dedupe-dup", changeEventId: "change-dup" });
    // Only the new record's row comes back; the duplicate was ignored by
    // ignoreDuplicates and never appears in the upsert's .select() result.
    const { db } = fakeDbForUpsert([{ id: "alert-new", dedupe_key: "dedupe-new" }]);
    const store = createSupabaseMonitoringStore(db);

    const { inserted } = await store.insertAlerts([newRecord, duplicateRecord]);

    expect(inserted).toEqual([{ ...newRecord, id: "alert-new" }]);
    expect(inserted).toHaveLength(1);
  });
});

describe("createSupabaseMonitoringStore notifyCriticalAlerts", () => {
  it("catches and swallows an error from notifyCriticalAlertsForVendor without rethrowing", async () => {
    notifyCriticalAlertsForVendor.mockReset();
    notifyCriticalAlertsForVendor.mockRejectedValueOnce(new Error("resend is down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const db = {} as Parameters<typeof createSupabaseMonitoringStore>[0];
    const store = createSupabaseMonitoringStore(db);
    const records: PersistedAlert[] = [{ ...buildAlertRecord(), id: "alert-1" }];

    await expect(store.notifyCriticalAlerts(records)).resolves.toBeUndefined();

    expect(notifyCriticalAlertsForVendor).toHaveBeenCalledWith(db, "vendor-1", records);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("logs and returns early without calling notifyCriticalAlertsForVendor when the batch mixes vendors", async () => {
    notifyCriticalAlertsForVendor.mockReset();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const db = {} as Parameters<typeof createSupabaseMonitoringStore>[0];
    const store = createSupabaseMonitoringStore(db);
    const records: PersistedAlert[] = [
      { ...buildAlertRecord({ vendorId: "vendor-1" }), id: "alert-1" },
      { ...buildAlertRecord({ vendorId: "vendor-2", dedupeKey: "dedupe-2" }), id: "alert-2" },
    ];

    await store.notifyCriticalAlerts(records);

    expect(notifyCriticalAlertsForVendor).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
