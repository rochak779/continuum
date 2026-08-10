import { describe, expect, it } from "vitest";

import { resolveAlert } from "./resolve-alert";
import type {
  AlertRecord,
  AlertResolutionStore,
  ChangeEventRecord,
  ResolveAlertInput,
} from "./types";

const ALERT: AlertRecord = {
  id: "alert-1",
  organisationId: "org-1",
  vendorId: "vendor-1",
  changeEventId: "change-1",
  status: "open",
};

const CHANGE_EVENT: ChangeEventRecord = {
  id: "change-1",
  vendorId: "vendor-1",
  provider: "companies_house",
  attributeKey: "company_status",
  newValue: "dissolved",
  status: "open",
};

interface FakeStoreOptions {
  alert?: AlertRecord | null;
  changeEvent?: ChangeEventRecord | null;
}

function createFakeStore(options: FakeStoreOptions = {}) {
  const alert = options.alert === undefined ? { ...ALERT } : options.alert;
  const changeEvent = options.changeEvent === undefined ? { ...CHANGE_EVENT } : options.changeEvent;

  const calls: {
    resolveAlert: unknown[];
    resolveChangeEvent: unknown[];
    upsertTrustProfileAttribute: unknown[];
    recordAuditEvent: unknown[];
  } = {
    resolveAlert: [],
    resolveChangeEvent: [],
    upsertTrustProfileAttribute: [],
    recordAuditEvent: [],
  };

  const store: AlertResolutionStore = {
    async getAlert() {
      return alert;
    },
    async getChangeEvent() {
      return changeEvent;
    },
    async resolveAlert(input) {
      calls.resolveAlert.push(input);
      if (alert) alert.status = "resolved";
    },
    async resolveChangeEvent(changeEventId) {
      calls.resolveChangeEvent.push(changeEventId);
      if (changeEvent) changeEvent.status = "resolved";
    },
    async upsertTrustProfileAttribute(input) {
      calls.upsertTrustProfileAttribute.push(input);
    },
    async recordAuditEvent(input) {
      calls.recordAuditEvent.push(input);
    },
  };

  return { store, calls };
}

function baseInput(overrides: Partial<ResolveAlertInput> = {}): ResolveAlertInput {
  return {
    alertId: "alert-1",
    resolutionType: "verified_accepted",
    reason: "Confirmed with Companies House filing history.",
    actor: { id: "user-1", type: "user" },
    ...overrides,
  };
}

describe("resolveAlert — verified_accepted", () => {
  it("updates the Trust Profile with the verified new value, resolves the alert and change event, and writes an audit event", async () => {
    const { store, calls } = createFakeStore();

    const outcome = await resolveAlert(store, baseInput());

    expect(outcome).toEqual({
      status: "resolved",
      alertId: "alert-1",
      changeEventId: "change-1",
      resolutionType: "verified_accepted",
    });

    expect(calls.upsertTrustProfileAttribute).toHaveLength(1);
    expect(calls.upsertTrustProfileAttribute[0]).toMatchObject({
      vendorId: "vendor-1",
      attributeKey: "company_status",
      value: "dissolved",
      source: "companies_house",
      changeEventId: "change-1",
    });

    expect(calls.resolveAlert).toEqual([
      {
        alertId: "alert-1",
        resolutionType: "verified_accepted",
        reason: "Confirmed with Companies House filing history.",
        resolvedBy: "user-1",
        resolvedAt: expect.any(String),
        ownerId: undefined,
        expiresAt: undefined,
      },
    ]);
    expect(calls.resolveChangeEvent).toEqual(["change-1"]);

    // verified_accepted writes two audit events: alert_resolved (every
    // resolution type) and trust_profile_updated (this branch only).
    expect(calls.recordAuditEvent).toHaveLength(2);
    const audit = calls.recordAuditEvent[0] as {
      organisationId: string;
      vendorId: string;
      actor: { id: string; type: string };
      eventType: string;
      entityType: string;
      entityId: string;
      metadata: Record<string, unknown>;
    };
    expect(audit.organisationId).toBe("org-1");
    expect(audit.vendorId).toBe("vendor-1");
    expect(audit.actor).toEqual({ id: "user-1", type: "user" });
    expect(audit.eventType).toBe("alert_resolved");
    expect(audit.entityType).toBe("alert");
    expect(audit.entityId).toBe("alert-1");
    expect(audit.metadata["reason"]).toBe("Confirmed with Companies House filing history.");
    expect(audit.metadata["changeEventId"]).toBe("change-1");

    const trustProfileAudit = calls.recordAuditEvent[1] as {
      eventType: string;
      entityType: string;
      metadata: Record<string, unknown>;
    };
    expect(trustProfileAudit.eventType).toBe("trust_profile_updated");
    expect(trustProfileAudit.entityType).toBe("trust_profile_attribute");
    expect(trustProfileAudit.metadata["attributeKey"]).toBe("company_status");
    expect(trustProfileAudit.metadata["newValue"]).toBe("dissolved");
  });

  it("records actor, timestamp, and reason on the resolved alert", async () => {
    const { store, calls } = createFakeStore();
    const before = Date.now();

    await resolveAlert(store, baseInput({ actor: { id: "user-42", type: "user" } }));

    const resolveCall = calls.resolveAlert[0] as {
      resolvedBy: string;
      resolvedAt: string;
      reason: string;
    };
    expect(resolveCall.resolvedBy).toBe("user-42");
    expect(resolveCall.reason).toBe("Confirmed with Companies House filing history.");
    expect(new Date(resolveCall.resolvedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("resolveAlert — false_positive", () => {
  it("never touches the Trust Profile, still resolves alert + change event, and writes an audit event", async () => {
    const { store, calls } = createFakeStore();

    const outcome = await resolveAlert(
      store,
      baseInput({
        resolutionType: "false_positive",
        reason: "Not our vendor — duplicate company number.",
      }),
    );

    expect(outcome.status).toBe("resolved");
    expect(calls.upsertTrustProfileAttribute).toHaveLength(0);
    expect(calls.resolveAlert).toEqual([
      expect.objectContaining({
        resolutionType: "false_positive",
        ownerId: undefined,
        expiresAt: undefined,
      }),
    ]);
    expect(calls.resolveChangeEvent).toEqual(["change-1"]);
    // Only alert_resolved — never trust_profile_updated, since this branch
    // never calls upsertTrustProfileAttribute.
    expect(calls.recordAuditEvent).toHaveLength(1);
    expect((calls.recordAuditEvent[0] as { eventType: string }).eventType).toBe("alert_resolved");
  });

  it("does not change the baseline even when the underlying change looks material", async () => {
    const { store, calls } = createFakeStore({
      changeEvent: { ...CHANGE_EVENT, attributeKey: "company_status", newValue: "dissolved" },
    });

    await resolveAlert(
      store,
      baseInput({ resolutionType: "false_positive", reason: "Data entry error at source." }),
    );

    expect(calls.upsertTrustProfileAttribute).toHaveLength(0);
  });
});

describe("resolveAlert — risk_accepted", () => {
  it("records owner and expiry, never touches the Trust Profile, and preserves the underlying change event", async () => {
    const { store, calls } = createFakeStore();

    const outcome = await resolveAlert(
      store,
      baseInput({
        resolutionType: "risk_accepted",
        reason: "Vendor is in a wind-down period we've already priced in.",
        ownerId: "owner-7",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    );

    expect(outcome.status).toBe("resolved");
    expect(calls.upsertTrustProfileAttribute).toHaveLength(0);
    expect(calls.resolveAlert).toEqual([
      expect.objectContaining({
        resolutionType: "risk_accepted",
        ownerId: "owner-7",
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    ]);
    // The detected change itself is preserved (only status flips, values untouched)
    // — resolveChangeEvent only ever receives the id, never a value patch.
    expect(calls.resolveChangeEvent).toEqual(["change-1"]);

    // Only alert_resolved — never trust_profile_updated.
    expect(calls.recordAuditEvent).toHaveLength(1);
    expect((calls.recordAuditEvent[0] as { eventType: string }).eventType).toBe("alert_resolved");
  });

  it("defaults ownerId to the acting user when none is given", async () => {
    const { store, calls } = createFakeStore();

    await resolveAlert(
      store,
      baseInput({
        resolutionType: "risk_accepted",
        reason: "Accepted by procurement lead.",
        actor: { id: "user-9", type: "user" },
      }),
    );

    expect(calls.resolveAlert).toEqual([expect.objectContaining({ ownerId: "user-9" })]);
  });

  it("works without an expiry date (ERD: optional)", async () => {
    const { store, calls } = createFakeStore();

    const outcome = await resolveAlert(
      store,
      baseInput({ resolutionType: "risk_accepted", reason: "No expiry needed." }),
    );

    expect(outcome.status).toBe("resolved");
    expect(calls.resolveAlert).toEqual([expect.objectContaining({ expiresAt: undefined })]);
  });
});

describe("resolveAlert — validation", () => {
  it("rejects a missing reason for every resolution type", async () => {
    for (const resolutionType of [
      "verified_accepted",
      "false_positive",
      "risk_accepted",
    ] as const) {
      const { store, calls } = createFakeStore();

      const outcome = await resolveAlert(store, baseInput({ resolutionType, reason: "" }));

      expect(outcome).toEqual({ status: "invalid_input", message: "reason is required." });
      expect(calls.resolveAlert).toHaveLength(0);
      expect(calls.recordAuditEvent).toHaveLength(0);
    }
  });

  it("rejects a whitespace-only reason", async () => {
    const { store } = createFakeStore();

    const outcome = await resolveAlert(store, baseInput({ reason: "   " }));

    expect(outcome).toEqual({ status: "invalid_input", message: "reason is required." });
  });

  it("rejects ownerId on a non-risk_accepted resolution", async () => {
    const { store } = createFakeStore();

    const outcome = await resolveAlert(
      store,
      baseInput({ resolutionType: "verified_accepted", ownerId: "someone" }),
    );

    expect(outcome.status).toBe("invalid_input");
  });

  it("rejects expiresAt on a non-risk_accepted resolution", async () => {
    const { store } = createFakeStore();

    const outcome = await resolveAlert(
      store,
      baseInput({ resolutionType: "false_positive", expiresAt: "2027-01-01T00:00:00.000Z" }),
    );

    expect(outcome.status).toBe("invalid_input");
  });
});

describe("resolveAlert — not found / idempotency", () => {
  it("returns not_found for a nonexistent alert and writes nothing", async () => {
    const { store, calls } = createFakeStore({ alert: null });

    const outcome = await resolveAlert(store, baseInput());

    expect(outcome).toEqual({ status: "not_found" });
    expect(calls.resolveAlert).toHaveLength(0);
    expect(calls.recordAuditEvent).toHaveLength(0);
  });

  it("returns not_found if the alert's change event is missing (should not happen given the FK, but handled)", async () => {
    const { store, calls } = createFakeStore({ changeEvent: null });

    const outcome = await resolveAlert(store, baseInput());

    expect(outcome).toEqual({ status: "not_found" });
    expect(calls.resolveAlert).toHaveLength(0);
  });

  it("refuses to re-resolve an already-resolved alert, and writes nothing a second time", async () => {
    const { store, calls } = createFakeStore({ alert: { ...ALERT, status: "resolved" } });

    const outcome = await resolveAlert(store, baseInput());

    expect(outcome).toEqual({ status: "already_resolved", alertId: "alert-1" });
    expect(calls.upsertTrustProfileAttribute).toHaveLength(0);
    expect(calls.resolveAlert).toHaveLength(0);
    expect(calls.resolveChangeEvent).toHaveLength(0);
    expect(calls.recordAuditEvent).toHaveLength(0);
  });

  it("resolving twice in sequence only writes history once", async () => {
    const { store, calls } = createFakeStore();

    const first = await resolveAlert(store, baseInput());
    const second = await resolveAlert(store, baseInput());

    expect(first.status).toBe("resolved");
    expect(second).toEqual({ status: "already_resolved", alertId: "alert-1" });
    // verified_accepted (the default in baseInput()) writes two audit
    // events — alert_resolved + trust_profile_updated — but only once, not
    // once per resolve() call.
    expect(calls.recordAuditEvent).toHaveLength(2);
    expect(calls.resolveAlert).toHaveLength(1);
  });
});

describe("resolveAlert — history preservation", () => {
  it("never mutates the change event's detection fields, only its status", async () => {
    const { store, calls } = createFakeStore();

    await resolveAlert(store, baseInput());

    // resolveChangeEvent is only ever called with the id — the store
    // interface has no way to pass a value patch, so previous_value/
    // new_value/attribute_key/severity can't be touched by this workflow.
    expect(calls.resolveChangeEvent).toEqual(["change-1"]);
  });

  it("an accepted risk still leaves the original change event resolvable/inspectable (status resolved, values intact)", async () => {
    const { store, calls } = createFakeStore();

    await resolveAlert(store, baseInput({ resolutionType: "risk_accepted", reason: "Accepted." }));

    expect(calls.resolveChangeEvent).toEqual(["change-1"]);
  });
});
