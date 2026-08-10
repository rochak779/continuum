import { describe, expect, it } from "vitest";

import {
  buildActionableAlerts,
  runCompaniesHouseCheck,
  type AlertRecord,
  type ChangeEventRecord,
  type FailureRecord,
  type MonitoringStore,
  type SnapshotRecord,
  type TrustProfileAttributeRecord,
} from "./monitor";
import type { CompaniesHouseResult, NormalisedCompanySnapshot } from "./types";
import { normaliseCompanyProfile } from "./normalize";

// In-memory store mirroring the real one's contract, including idempotent
// insertAlerts keyed on dedupeKey.
function createFakeStore() {
  const snapshots: (SnapshotRecord & { vendorId: string })[] = [];
  const alerts: AlertRecord[] = [];
  const failures: FailureRecord[] = [];
  const trustProfileAttributes: TrustProfileAttributeRecord[] = [];
  const changeEvents: ChangeEventRecord[] = [];
  const seenDedupeKeys = new Set<string>();
  const seenEventKeys = new Set<string>();
  const eventIdsByKey = new Map<string, string>();

  const store: MonitoringStore = {
    async getTrustProfile(vendorId) {
      return Object.fromEntries(
        trustProfileAttributes
          .filter((attribute) => attribute.vendorId === vendorId)
          .map((attribute) => [attribute.attributeKey, attribute.currentValue]),
      );
    },
    async insertSnapshot(record) {
      snapshots.push(record);
      return `snapshot-${snapshots.length}`;
    },
    async createTrustBaseline(records) {
      trustProfileAttributes.push(...records);
    },
    async insertChangeEvents(records) {
      let inserted = 0;
      for (const record of records) {
        if (seenEventKeys.has(record.dedupeKey)) continue;
        seenEventKeys.add(record.dedupeKey);
        eventIdsByKey.set(record.dedupeKey, `event-${eventIdsByKey.size + 1}`);
        changeEvents.push(record);
        inserted += 1;
      }
      return {
        inserted,
        events: records.map((record) => ({
          ...record,
          id: eventIdsByKey.get(record.dedupeKey)!,
        })),
      };
    },
    async insertAlerts(records) {
      let inserted = 0;
      for (const r of records) {
        if (seenDedupeKeys.has(r.dedupeKey)) continue;
        seenDedupeKeys.add(r.dedupeKey);
        alerts.push(r);
        inserted += 1;
      }
      return { inserted };
    },
    async recordFailure(record) {
      failures.push(record);
    },
  };

  return { store, snapshots, alerts, failures, trustProfileAttributes, changeEvents };
}

function okResult(overrides: Record<string, unknown> = {}): CompaniesHouseResult {
  return {
    ok: true,
    data: {
      company_number: "00000006",
      company_name: "ACME LTD",
      company_status: "active",
      type: "ltd",
      sic_codes: ["62012"],
      registered_office_address: { address_line_1: "1 High Street" },
      ...overrides,
    },
  };
}

const VENDOR = "vendor-1";

describe("runCompaniesHouseCheck", () => {
  it("persists a baseline snapshot on first successful lookup, no alerts", async () => {
    const { store, snapshots, alerts, trustProfileAttributes } = createFakeStore();
    const outcome = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      {
        fetchProfile: async () =>
          okResult({
            jurisdiction: "england-wales",
            accounts: { next_due: "2027-03-31" },
          }),
        store,
        now: () => new Date("2026-08-10T12:34:56.000Z"),
      },
    );

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.isBaseline).toBe(true);
      expect(outcome.changes).toHaveLength(0);
    }
    expect(snapshots).toHaveLength(1);
    expect(alerts).toHaveLength(0);
    expect(trustProfileAttributes).toEqual(
      expect.arrayContaining([
        {
          vendorId: VENDOR,
          attributeKey: "company_status",
          currentValue: "active",
          source: "companies_house",
          verifiedAt: "2026-08-10T12:34:56.000Z",
        },
        expect.objectContaining({
          attributeKey: "registered_address",
          currentValue: { address_line_1: "1 High Street" },
        }),
        expect.objectContaining({ attributeKey: "sic_codes", currentValue: ["62012"] }),
        expect.objectContaining({ attributeKey: "accounts_next_due", currentValue: "2027-03-31" }),
      ]),
    );
  });

  it("creates no change event when a subsequent check matches the Trust Profile", async () => {
    const { store, snapshots, alerts, trustProfileAttributes, changeEvents } = createFakeStore();
    const deps = { fetchProfile: async () => okResult(), store };

    await runCompaniesHouseCheck({ vendorId: VENDOR, companyNumber: "00000006" }, deps);
    await runCompaniesHouseCheck({ vendorId: VENDOR, companyNumber: "00000006" }, deps);

    expect(snapshots).toHaveLength(2); // both observations preserved
    expect(alerts).toHaveLength(0);
    expect(changeEvents).toHaveLength(0);
    expect(trustProfileAttributes.filter((a) => a.attributeKey === "company_status")).toHaveLength(
      1,
    );
  });

  it("creates one deterministic event for one changed attribute", async () => {
    const { store, alerts, changeEvents } = createFakeStore();

    await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult(), store },
    );
    const outcome = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult({ company_status: "dissolved" }), store },
    );

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.eventsCreated).toBe(1);
      expect(outcome.alertsCreated).toBe(1);
    }
    expect(changeEvents).toHaveLength(1);
    expect(changeEvents[0]).toMatchObject({
      snapshotId: "snapshot-2",
      attribute: "company_status",
      previousValue: "active",
      newValue: "dissolved",
      severity: "critical",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      changeEventId: "event-1",
      snapshotId: "snapshot-2",
      attribute: "company_status",
      severity: "critical",
      newValue: "dissolved",
    });
  });

  it("creates separate events when multiple trusted attributes change", async () => {
    const { store, changeEvents, alerts } = createFakeStore();
    await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult(), store },
    );

    const outcome = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      {
        fetchProfile: async () =>
          okResult({ company_name: "ACME GLOBAL LTD", sic_codes: ["63110", "62012"] }),
        store,
      },
    );

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.eventsCreated).toBe(2);
    expect(changeEvents.map((event) => event.attribute)).toEqual(["company_name", "sic_codes"]);
    expect(alerts).toHaveLength(2);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeEventId: "event-1",
          snapshotId: "snapshot-2",
          attribute: "company_name",
          severity: "attention",
        }),
        expect.objectContaining({
          changeEventId: "event-2",
          snapshotId: "snapshot-2",
          attribute: "sic_codes",
          severity: "attention",
        }),
      ]),
    );
  });

  it("records a monitoring failure and writes no snapshot on API failure", async () => {
    const { store, snapshots, alerts, failures, trustProfileAttributes } = createFakeStore();

    const outcome = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      {
        fetchProfile: async (): Promise<CompaniesHouseResult> => ({
          ok: false,
          errorType: "not_found",
          message: "not found",
          httpStatus: 404,
        }),
        store,
      },
    );

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.errorType).toBe("not_found");
    expect(failures).toHaveLength(1);
    expect(snapshots).toHaveLength(0); // vendor data untouched
    expect(alerts).toHaveLength(0);
    expect(trustProfileAttributes).toHaveLength(0);
  });

  it("records a monitoring failure on a rate-limit (429) response", async () => {
    const { store, failures, snapshots } = createFakeStore();

    const outcome = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      {
        fetchProfile: async (): Promise<CompaniesHouseResult> => ({
          ok: false,
          errorType: "rate_limited",
          message: "429",
          httpStatus: 429,
          retryAfterSeconds: 30,
        }),
        store,
      },
    );

    expect(outcome.status).toBe("failed");
    expect(failures[0]).toMatchObject({ errorType: "rate_limited", httpStatus: 429 });
    expect(snapshots).toHaveLength(0);
  });

  it("does not duplicate change events when an identical state is retried", async () => {
    const { store, alerts, changeEvents } = createFakeStore();
    const active = { fetchProfile: async () => okResult(), store };
    const dissolved = {
      fetchProfile: async () => okResult({ company_status: "dissolved" }),
      store,
    };

    await runCompaniesHouseCheck({ vendorId: VENDOR, companyNumber: "00000006" }, active);
    const first = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      dissolved,
    );
    const retry = await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      dissolved,
    );

    if (first.status === "ok") expect(first.eventsCreated).toBe(1);
    if (retry.status === "ok") expect(retry.eventsCreated).toBe(0);
    expect(changeEvents).toHaveLength(1);
    expect(alerts).toHaveLength(1);
  });

  it("keeps informational events in history without creating alerts", () => {
    const alerts = buildActionableAlerts([
      {
        id: "event-info",
        vendorId: VENDOR,
        snapshotId: "snapshot-info",
        source: "companies_house",
        attribute: "company_type",
        previousValue: "ltd",
        newValue: "plc",
        severity: "info",
        detectedAt: "2026-08-10T12:34:56.000Z",
        dedupeKey: "info-key",
      },
    ]);

    expect(alerts).toEqual([]);
  });
});

// Guards the normaliser's contract that snapshots round-trip through detection.
describe("normaliseCompanyProfile", () => {
  it("sorts sic codes and trims empty address fields", () => {
    const snap = normaliseCompanyProfile({
      company_number: "00000006",
      sic_codes: ["63110", "62012"],
      registered_office_address: { address_line_1: "  ", postal_code: "EC1A 1AA" },
    });
    expect(snap.sicCodes).toEqual(["62012", "63110"]);
    expect(snap.registeredOfficeAddress).toEqual({ postal_code: "EC1A 1AA" });
  });
});
