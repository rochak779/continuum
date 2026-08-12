import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyCriticalAlerts, type NotifyCriticalAlertsDeps } from "./notify-critical-alerts";

const ALERT = {
  id: "alert-1",
  attribute: "company_status",
  previousValue: "active",
  newValue: "dissolved",
};

function createDeps(overrides: Partial<NotifyCriticalAlertsDeps> = {}): {
  deps: NotifyCriticalAlertsDeps;
  sendCalls: Array<{ to: string; subject: string; html: string; text: string }>;
} {
  const sendCalls: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const deps: NotifyCriticalAlertsDeps = {
    getVendor: async () => ({ companyName: "Acme Ltd", ownerId: "owner-1" }),
    getOwnerEmail: async () => "owner@example.com",
    sendEmail: async (input) => {
      sendCalls.push(input);
      return { ok: true };
    },
    siteUrl: "https://app.example.com",
    ...overrides,
  };
  return { deps, sendCalls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyCriticalAlerts", () => {
  it("does nothing when there are no alerts", async () => {
    const { deps, sendCalls } = createDeps({
      getVendor: async () => {
        throw new Error("should not be called");
      },
    });

    await notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [] }, deps);

    expect(sendCalls).toHaveLength(0);
  });

  it("sends one email to the owner's address with the built digest", async () => {
    const { deps, sendCalls } = createDeps();

    await notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [ALERT] }, deps);

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.to).toBe("owner@example.com");
    expect(sendCalls[0]?.subject).toContain("Acme Ltd");
    expect(sendCalls[0]?.html).toContain("https://app.example.com/alerts/alert-1");
  });

  it("skips sending, without throwing, when the vendor cannot be found", async () => {
    const { deps, sendCalls } = createDeps({ getVendor: async () => null });

    await expect(
      notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [ALERT] }, deps),
    ).resolves.toBeUndefined();
    expect(sendCalls).toHaveLength(0);
  });

  it("skips sending, without throwing, when the owner has no email on file", async () => {
    const { deps, sendCalls } = createDeps({ getOwnerEmail: async () => null });

    await expect(
      notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [ALERT] }, deps),
    ).resolves.toBeUndefined();
    expect(sendCalls).toHaveLength(0);
  });

  it("never throws when a dependency rejects", async () => {
    const { deps } = createDeps({
      getVendor: async () => {
        throw new Error("db is down");
      },
    });

    await expect(
      notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [ALERT] }, deps),
    ).resolves.toBeUndefined();
  });

  it("never throws when sendEmail itself reports failure", async () => {
    const { deps } = createDeps({ sendEmail: async () => ({ ok: false, message: "boom" }) });

    await expect(
      notifyCriticalAlerts({ vendorId: "vendor-1", alerts: [ALERT] }, deps),
    ).resolves.toBeUndefined();
  });
});
