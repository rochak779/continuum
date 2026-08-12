// src/integrations/assistant/tools.test.ts
import { describe, expect, it } from "vitest";

import {
  getOpenAlerts,
  getVendorAuditHistory,
  getVendorChanges,
  getVendorTrustProfile,
  listVendors,
  searchVendorDocuments,
} from "./tools";
import type {
  AssistantDataStore,
  DocumentChunkMatch,
  VendorAlert,
  VendorAuditEvent,
  VendorChangeEvent,
  VendorSummary,
} from "./store";

const VENDORS: VendorSummary[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    companyName: "Acme Logistics",
    category: "Logistics",
    country: "GB",
    riskLevel: "medium",
    monitoringStatus: "monitoring",
    health: "healthy",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    companyName: "Beta Supplies",
    category: "Supplies",
    country: "GB",
    riskLevel: "high",
    monitoringStatus: "monitoring",
    health: "critical",
  },
];

interface Calls {
  listVendors: unknown[];
  getVendorTrustProfile: unknown[];
  getVendorChanges: unknown[];
  getOpenAlerts: unknown[];
  getVendorAuditHistory: unknown[];
  searchVendorDocuments: unknown[];
}

function createFakeStore(overrides: Partial<AssistantDataStore> = {}): {
  store: AssistantDataStore;
  calls: Calls;
} {
  const calls: Calls = {
    listVendors: [],
    getVendorTrustProfile: [],
    getVendorChanges: [],
    getOpenAlerts: [],
    getVendorAuditHistory: [],
    searchVendorDocuments: [],
  };

  const store: AssistantDataStore = {
    async listVendors() {
      calls.listVendors.push({});
      return VENDORS;
    },
    async getVendorTrustProfile(vendorId) {
      calls.getVendorTrustProfile.push({ vendorId });
      return [];
    },
    async getVendorChanges(vendorId, sinceDate) {
      calls.getVendorChanges.push({ vendorId, sinceDate });
      return [];
    },
    async getOpenAlerts(severity, vendorId) {
      calls.getOpenAlerts.push({ severity, vendorId });
      return [];
    },
    async getVendorAuditHistory(vendorId, sinceDate) {
      calls.getVendorAuditHistory.push({ vendorId, sinceDate });
      return [];
    },
    async searchVendorDocuments(query, vendorId, callerId) {
      calls.searchVendorDocuments.push({ query, vendorId, callerId });
      return [];
    },
    ...overrides,
  };

  return { store, calls };
}

const VALID_VENDOR_ID = "11111111-1111-1111-1111-111111111111";

describe("listVendors", () => {
  it("returns all vendors when no filters are given", async () => {
    const { store } = createFakeStore();
    const result = await listVendors(store, {});
    expect(result).toEqual({ ok: true, data: VENDORS });
  });

  it("filters by health", async () => {
    const { store } = createFakeStore();
    const result = await listVendors(store, { health: "critical" });
    expect(result).toEqual({ ok: true, data: [VENDORS[1]] });
  });

  it("filters by a case-insensitive name search", async () => {
    const { store } = createFakeStore();
    const result = await listVendors(store, { search: "acme" });
    expect(result).toEqual({ ok: true, data: [VENDORS[0]] });
  });

  it("caps results at 20 rows", async () => {
    const many: VendorSummary[] = Array.from({ length: 30 }, (_, i) => ({
      ...VENDORS[0]!,
      id: `vendor-${i}`,
      companyName: `Vendor ${i}`,
    }));
    const { store } = createFakeStore({ async listVendors() { return many; } });
    const result = await listVendors(store, {});
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: VendorSummary[] }).data).toHaveLength(20);
  });

  it("rejects invalid arguments", async () => {
    const { store } = createFakeStore();
    // @ts-expect-error -- deliberately invalid for the test
    const result = await listVendors(store, { health: "not-a-real-health" });
    expect(result.ok).toBe(false);
  });

  it("returns an error result (not a throw) when the store fails", async () => {
    const { store } = createFakeStore({
      async listVendors() { throw new Error("db down"); },
    });
    const result = await listVendors(store, {});
    expect(result).toEqual({ ok: false, error: "Could not load vendors." });
  });
});

describe("getVendorTrustProfile", () => {
  it("passes the vendorId through to the store", async () => {
    const { store, calls } = createFakeStore();
    const result = await getVendorTrustProfile(store, { vendorId: VALID_VENDOR_ID });
    expect(result.ok).toBe(true);
    expect(calls.getVendorTrustProfile).toEqual([{ vendorId: VALID_VENDOR_ID }]);
  });

  it("rejects a non-UUID vendorId", async () => {
    const { store } = createFakeStore();
    const result = await getVendorTrustProfile(store, { vendorId: "not-a-uuid" });
    expect(result.ok).toBe(false);
  });
});

describe("getVendorChanges", () => {
  it("caps results at 20 rows", async () => {
    const many: VendorChangeEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `change-${i}`,
      vendorId: VALID_VENDOR_ID,
      vendorName: "Acme Logistics",
      attributeKey: "company_status",
      previousValue: "active",
      newValue: "dissolved",
      severity: "critical",
      status: "open",
      detectedAt: new Date().toISOString(),
    }));
    const { store } = createFakeStore({ async getVendorChanges() { return many; } });
    const result = await getVendorChanges(store, { vendorId: VALID_VENDOR_ID });
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: VendorChangeEvent[] }).data).toHaveLength(20);
  });

  it("rejects a malformed sinceDate", async () => {
    const { store } = createFakeStore();
    const result = await getVendorChanges(store, { vendorId: VALID_VENDOR_ID, sinceDate: "not-a-date" });
    expect(result.ok).toBe(false);
  });
});

describe("getOpenAlerts", () => {
  it("passes severity and vendorId through, defaulting both to null", async () => {
    const { store, calls } = createFakeStore();
    await getOpenAlerts(store, {});
    expect(calls.getOpenAlerts).toEqual([{ severity: null, vendorId: null }]);
  });

  it("caps results at 20 rows", async () => {
    const many: VendorAlert[] = Array.from({ length: 25 }, (_, i) => ({
      id: `alert-${i}`,
      vendorId: VALID_VENDOR_ID,
      vendorName: "Acme Logistics",
      attributeChecked: "company_status",
      severity: "critical",
      status: "open",
      detectedAt: new Date().toISOString(),
    }));
    const { store } = createFakeStore({ async getOpenAlerts() { return many; } });
    const result = await getOpenAlerts(store, {});
    expect((result as { ok: true; data: VendorAlert[] }).data).toHaveLength(20);
  });
});

describe("getVendorAuditHistory", () => {
  it("caps results at 20 rows", async () => {
    const many: VendorAuditEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `audit-${i}`,
      vendorId: VALID_VENDOR_ID,
      eventType: "alert_resolved",
      entityType: "alert",
      entityId: `alert-${i}`,
      createdAt: new Date().toISOString(),
    }));
    const { store } = createFakeStore({ async getVendorAuditHistory() { return many; } });
    const result = await getVendorAuditHistory(store, { vendorId: VALID_VENDOR_ID });
    expect((result as { ok: true; data: VendorAuditEvent[] }).data).toHaveLength(20);
  });
});

describe("searchVendorDocuments — guardrails", () => {
  it("always passes the caller's own id to the store, ignoring any ownerId-shaped field in args", async () => {
    const { store, calls } = createFakeStore();

    const hostileArgs = { query: "insurance", ownerId: "attacker-controlled-id" } as unknown as {
      query: string;
      vendorId?: string;
    };

    await searchVendorDocuments(store, hostileArgs, "real-caller-id");

    expect(calls.searchVendorDocuments).toEqual([
      { query: "insurance", vendorId: null, callerId: "real-caller-id" },
    ]);
  });

  it("caps results at 5 chunks", async () => {
    const many: DocumentChunkMatch[] = Array.from({ length: 10 }, (_, i) => ({
      vendorId: VALID_VENDOR_ID,
      vendorName: "Acme Logistics",
      fileName: `doc-${i}.pdf`,
      content: "some content",
      similarity: 0.9,
    }));
    const { store } = createFakeStore({ async searchVendorDocuments() { return many; } });
    const result = await searchVendorDocuments(store, { query: "insurance" }, "caller-id");
    expect((result as { ok: true; data: DocumentChunkMatch[] }).data).toHaveLength(5);
  });

  it("rejects an empty query", async () => {
    const { store } = createFakeStore();
    const result = await searchVendorDocuments(store, { query: "" }, "caller-id");
    expect(result.ok).toBe(false);
  });
});
