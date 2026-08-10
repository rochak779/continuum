import { describe, expect, it } from "vitest";

import { AUDIT_EVENT_TYPES } from "./event-types";
import type { AuditEventInput, AuditEventWriter } from "./types";

/**
 * A minimal in-memory AuditEventWriter, used here only to prove the
 * interface's shape: `record` is the only capability it exposes. There is
 * no update/delete method to call even by mistake — TypeScript won't let a
 * caller invoke one that doesn't exist, which is the compile-time half of
 * "append-only through normal application behaviour" (the DB grants are
 * the runtime half — see record-audit-event.server.ts).
 */
function createInMemoryAuditEventWriter() {
  const records: AuditEventInput[] = [];
  let counter = 0;

  const writer: AuditEventWriter = {
    async record(input: AuditEventInput) {
      records.push(input);
      return { id: `audit-${++counter}`, createdAt: new Date().toISOString() };
    },
  };

  return { writer, records };
}

const BASE_INPUT: AuditEventInput = {
  organisationId: "org-1",
  vendorId: "vendor-1",
  actor: { id: "user-1", type: "user" },
  eventType: AUDIT_EVENT_TYPES.MONITORING_STARTED,
  entityType: "monitoring_run",
  entityId: "run-1",
  metadata: { provider: "companies_house" },
};

describe("AuditEventWriter", () => {
  it("exposes exactly one capability: record", () => {
    const { writer } = createInMemoryAuditEventWriter();

    expect(Object.keys(writer)).toEqual(["record"]);
  });

  it("record() appends without needing/accepting an id — every call is a new row", async () => {
    const { writer, records } = createInMemoryAuditEventWriter();

    const first = await writer.record(BASE_INPUT);
    const second = await writer.record(BASE_INPUT);

    expect(first.id).not.toBe(second.id);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(BASE_INPUT);
    expect(records[1]).toEqual(BASE_INPUT);
  });

  it("returns an id and createdAt for the newly appended row", async () => {
    const { writer } = createInMemoryAuditEventWriter();

    const result = await writer.record(BASE_INPUT);

    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(() => new Date(result.createdAt).toISOString()).not.toThrow();
  });

  it("supports a null actor id for system-initiated events", async () => {
    const { writer, records } = createInMemoryAuditEventWriter();

    await writer.record({ ...BASE_INPUT, actor: { id: null, type: "system" } });

    expect(records[0]?.actor).toEqual({ id: null, type: "system" });
  });

  it("supports a null vendorId for organisation-level events", async () => {
    const { writer, records } = createInMemoryAuditEventWriter();

    await writer.record({ ...BASE_INPUT, vendorId: null });

    expect(records[0]?.vendorId).toBeNull();
  });

  it("defaults to no metadata object being required beyond what's passed", async () => {
    const { writer, records } = createInMemoryAuditEventWriter();

    await writer.record({ ...BASE_INPUT, metadata: undefined });

    expect(records[0]?.metadata).toBeUndefined();
  });
});
