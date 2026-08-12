# Critical-Alert Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Companies House monitoring check inserts one or more genuinely new `critical`-severity alerts for a vendor, email the vendor's owner a digest describing what changed, with a link to each alert.

**Architecture:** Extend the existing `MonitoringStore` interface (`src/integrations/companies-house/monitor.ts`) with one new method, `notifyCriticalAlerts`, following the same store-boundary pattern every other side effect in that pipeline already uses. The actual email logic lives in a new `src/integrations/notifications/` module, split pure/server exactly like `companies-house/monitor.ts` + `monitor.server.ts` (pure orchestration with injected deps vs. Supabase/Resend-touching wiring). No SDK dependency is added — Resend is called via `fetch` against its REST API, matching how `companies-house/client.ts` already talks to an external API.

**Tech Stack:** TypeScript, Vitest, Supabase (service-role client, `auth.admin.getUserById`), Resend REST API, Vercel Marketplace CLI.

## Global Constraints

- Owner-only recipient — no multi-tenancy exists yet, so the vendor's `owner_id` (resolved to an email via `auth.admin.getUserById`, since `profiles` has no `email` column) is the only recipient. (source: spec, Context/Non-goals)
- `critical` severity only — never `attention`/`info`, never document expiries. (source: spec, Goal/Non-goals)
- One digest email per vendor per check, not one email per alert. A monitoring check is always single-vendor, so "per check" and "per vendor" are the same grouping. (source: spec, §1)
- A failure anywhere in the notification path (missing email, Resend error, unexpected exception) must be logged and swallowed — it must never change `runCompaniesHouseCheck`'s return value or throw out of the monitoring pipeline. (source: spec, Error handling)
- No notification-preferences UI / opt-out in this pass. (source: spec, Non-goals)
- Resend is the provider (Vercel Marketplace `messaging` category, confirmed via `vercel integration discover --category messaging` — it was the only relevant result). Provision via `vercel integration add resend/resend-email --yes`, not a hand-rolled mock. (source: spec, §4; conversation's marketplace discovery)

---

### Task 1: Widen the monitoring pipeline's alert plumbing (`monitor.ts`)

**Files:**
- Modify: `src/integrations/companies-house/monitor.ts`
- Test: `src/integrations/companies-house/monitor.test.ts`

**Interfaces:**
- Produces: `PersistedAlert` (= `AlertRecord & { id: string }`), and a widened `MonitoringStore` with `insertAlerts(records: AlertRecord[]): Promise<{ inserted: PersistedAlert[] }>` (was `{ inserted: number }`) and a new `notifyCriticalAlerts(records: PersistedAlert[]): Promise<void>`. Later tasks' server-side store implementation (Task 5) must match this exact shape.

This task only touches the pure module — the real Supabase-backed store (`monitor.server.ts`) is updated in Task 5. The fake store in this task's tests plays the role of "any conforming `MonitoringStore`," which is exactly what makes this task independently testable before the notifications module exists.

- [ ] **Step 1: Update the fake store in `monitor.test.ts` to the new `insertAlerts` shape and add a `notifyCriticalAlerts` spy**

In `src/integrations/companies-house/monitor.test.ts`, replace the `insertAlerts` implementation inside `createFakeStore()`:

```typescript
    async insertAlerts(records) {
      const inserted: PersistedAlert[] = [];
      for (const r of records) {
        if (seenDedupeKeys.has(r.dedupeKey)) continue;
        seenDedupeKeys.add(r.dedupeKey);
        const persisted: PersistedAlert = { ...r, id: `alert-${alerts.length + 1}` };
        alerts.push(persisted);
        inserted.push(persisted);
      }
      return { inserted };
    },
    async notifyCriticalAlerts(records) {
      criticalNotifications.push(records);
    },
```

Add `criticalNotifications: PersistedAlert[][] = []` alongside the other arrays declared at the top of `createFakeStore()` (next to `const alerts: AlertRecord[] = [];` — change that declaration to `const alerts: PersistedAlert[] = [];` too, since the store now always deals in persisted records), and return it from `createFakeStore()`'s final object alongside `alerts`, `failures`, etc.

Add `PersistedAlert` to the `import { ... } from "./monitor"` list at the top of the file.

- [ ] **Step 2: Run the existing suite to confirm it fails on the type/shape mismatch**

Run: `npx vitest run src/integrations/companies-house/monitor.test.ts`
Expected: FAIL — `insertAlerts`/`notifyCriticalAlerts` don't exist yet on `MonitoringStore`'s type, and existing assertions like `expect(alerts[0]?.severity)` still work once `PersistedAlert` extends `AlertRecord`, but the file won't typecheck/compile until Step 3.

- [ ] **Step 3: Widen `MonitoringStore` and `runCompaniesHouseCheck` in `monitor.ts`**

Add this new interface right after `PersistedChangeEvent`:

```typescript
export interface PersistedAlert extends AlertRecord {
  id: string;
}
```

Change the `insertAlerts` line in the `MonitoringStore` interface from:

```typescript
  insertAlerts(records: AlertRecord[]): Promise<{ inserted: number }>;
```

to:

```typescript
  insertAlerts(records: AlertRecord[]): Promise<{ inserted: PersistedAlert[] }>;
  /**
   * Best-effort side channel: send an email to the vendor's owner about
   * newly-inserted critical alerts. MUST NOT throw — implementations are
   * responsible for catching and logging their own failures (missing
   * owner email, provider error, etc.) so a notification failure can never
   * regress the monitoring pipeline itself, the same isolation guarantee
   * this interface already gives failed provider fetches.
   */
  notifyCriticalAlerts(records: PersistedAlert[]): Promise<void>;
```

In `runCompaniesHouseCheck`, replace:

```typescript
    const alertRecords = buildActionableAlerts(persisted.events);
    const { inserted } = await store.insertAlerts(alertRecords);
    alertsCreated = inserted;
```

with:

```typescript
    const alertRecords = buildActionableAlerts(persisted.events);
    const { inserted } = await store.insertAlerts(alertRecords);
    alertsCreated = inserted.length;

    const criticalAlerts = inserted.filter((alert) => alert.severity === "critical");
    if (criticalAlerts.length > 0) {
      await store.notifyCriticalAlerts(criticalAlerts);
    }
```

- [ ] **Step 4: Run tests, expect the pre-existing suite to pass again**

Run: `npx vitest run src/integrations/companies-house/monitor.test.ts`
Expected: PASS — the widened types compile and all existing assertions (which only ever read `.severity`, `.attribute`, etc. off alert records — not the removed `{ inserted: number }` shape directly) still hold.

- [ ] **Step 5: Add a test proving a critical alert triggers notification and an attention alert does not**

Add to `src/integrations/companies-house/monitor.test.ts`, inside the `describe("runCompaniesHouseCheck", ...)` block:

```typescript
  it("notifies on a new critical alert but not on a new attention-only alert", async () => {
    const { store, criticalNotifications } = createFakeStore();

    // Baseline check (creates no alerts, no notifications).
    await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult(), store },
    );
    expect(criticalNotifications).toHaveLength(0);

    // Attention-severity change: company_name changes, nothing critical.
    await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult({ company_name: "ACME HOLDINGS LTD" }), store },
    );
    expect(criticalNotifications).toHaveLength(0);

    // Critical-severity change: company_status -> dissolved.
    await runCompaniesHouseCheck(
      { vendorId: VENDOR, companyNumber: "00000006" },
      { fetchProfile: async () => okResult({ company_status: "dissolved" }), store },
    );
    expect(criticalNotifications).toHaveLength(1);
    expect(criticalNotifications[0]).toHaveLength(1);
    expect(criticalNotifications[0]?.[0]).toMatchObject({
      attribute: "company_status",
      severity: "critical",
      newValue: "dissolved",
    });
  });

  it("does not notify again when a recheck only re-confirms an existing alert", async () => {
    const { store, criticalNotifications } = createFakeStore();
    const deps = { fetchProfile: async () => okResult({ company_status: "dissolved" }), store };

    // First check: baseline already dissolved -> one critical alert, one notification.
    await runCompaniesHouseCheck({ vendorId: VENDOR, companyNumber: "00000006" }, deps);
    expect(criticalNotifications).toHaveLength(1);

    // Companies House re-fetch with the same dissolved status: the Trust
    // Profile already matches, so detectChanges finds nothing new and
    // insertAlerts never runs again for this attribute.
    await runCompaniesHouseCheck({ vendorId: VENDOR, companyNumber: "00000006" }, deps);
    expect(criticalNotifications).toHaveLength(1);
  });
```

- [ ] **Step 6: Run the full test file**

Run: `npx vitest run src/integrations/companies-house/monitor.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add src/integrations/companies-house/monitor.ts src/integrations/companies-house/monitor.test.ts
git commit -m "feat(monitoring): widen insertAlerts to expose persisted records, add notifyCriticalAlerts to MonitoringStore

Pure pipeline change only — runCompaniesHouseCheck now calls
store.notifyCriticalAlerts() with newly-inserted critical alerts. The
real Supabase-backed implementation lands in a later commit; the fake
test store stands in for any conforming MonitoringStore."
```

---

### Task 2: Build the critical-alert email content

**Files:**
- Create: `src/integrations/notifications/build-critical-alert-email.ts`
- Test: `src/integrations/notifications/build-critical-alert-email.test.ts`

**Interfaces:**
- Consumes: `alertAttributeLabel`, `describeAlertReason` from `src/lib/alert-labels.ts` (both already exist, unchanged).
- Produces: `CriticalAlertEmailItem`, `CriticalAlertEmailInput`, `CriticalAlertEmail`, and `buildCriticalAlertEmail(input: CriticalAlertEmailInput): CriticalAlertEmail`. Task 4 imports this function and these types directly.

- [ ] **Step 1: Write the failing test**

Create `src/integrations/notifications/build-critical-alert-email.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { buildCriticalAlertEmail } from "./build-critical-alert-email";

const SITE_URL = "https://app.example.com";

describe("buildCriticalAlertEmail", () => {
  it("builds a single-alert subject and includes the alert link", () => {
    const email = buildCriticalAlertEmail({
      vendorName: "Acme Ltd",
      siteUrl: SITE_URL,
      alerts: [
        {
          id: "alert-1",
          attribute: "company_status",
          previousValue: "active",
          newValue: "dissolved",
        },
      ],
    });

    expect(email.subject).toBe("Critical alert: Acme Ltd — Company Status");
    expect(email.text).toContain("Company Status changed from active to dissolved.");
    expect(email.text).toContain("https://app.example.com/alerts/alert-1");
    expect(email.html).toContain("Company Status changed from active to dissolved.");
    expect(email.html).toContain('href="https://app.example.com/alerts/alert-1"');
  });

  it("builds a digest subject and lists every alert when there are several", () => {
    const email = buildCriticalAlertEmail({
      vendorName: "Acme Ltd",
      siteUrl: SITE_URL,
      alerts: [
        { id: "alert-1", attribute: "company_status", previousValue: "active", newValue: "dissolved" },
        { id: "alert-2", attribute: "company_name", previousValue: "Acme Ltd", newValue: "Acme Holdings Ltd" },
      ],
    });

    expect(email.subject).toBe("2 critical alerts: Acme Ltd");
    expect(email.text).toContain("Company Status changed from active to dissolved.");
    expect(email.text).toContain("Company Name changed from Acme Ltd to Acme Holdings Ltd.");
    expect(email.html).toContain("https://app.example.com/alerts/alert-1");
    expect(email.html).toContain("https://app.example.com/alerts/alert-2");
  });

  it("escapes HTML-significant characters in vendor name and values", () => {
    const email = buildCriticalAlertEmail({
      vendorName: 'Acme <script>alert("x")</script> Ltd',
      siteUrl: SITE_URL,
      alerts: [
        { id: "alert-1", attribute: "company_name", previousValue: "A & B", newValue: "A & B <Co>" },
      ],
    });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("A &amp; B &lt;Co&gt;");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/integrations/notifications/build-critical-alert-email.test.ts`
Expected: FAIL with "Cannot find module './build-critical-alert-email'"

- [ ] **Step 3: Implement `build-critical-alert-email.ts`**

Create `src/integrations/notifications/build-critical-alert-email.ts`:

```typescript
// Pure builder for the critical-alert digest email. No Node/Supabase/Resend
// imports here — see ./notify-critical-alerts.server.ts for the wiring that
// calls this and actually sends the result.
//
// Reuses src/lib/alert-labels.ts's alertAttributeLabel/describeAlertReason
// so the email describes a change with the exact same wording the Alerts UI
// already uses.

import { alertAttributeLabel, describeAlertReason } from "@/lib/alert-labels";

export interface CriticalAlertEmailItem {
  id: string;
  attribute: string;
  previousValue: string | null;
  newValue: string | null;
}

export interface CriticalAlertEmailInput {
  vendorName: string;
  siteUrl: string;
  alerts: CriticalAlertEmailItem[];
}

export interface CriticalAlertEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildCriticalAlertEmail(input: CriticalAlertEmailInput): CriticalAlertEmail {
  const { vendorName, siteUrl, alerts } = input;

  const subject =
    alerts.length === 1
      ? `Critical alert: ${vendorName} — ${alertAttributeLabel(alerts[0]!.attribute)}`
      : `${alerts.length} critical alerts: ${vendorName}`;

  const items = alerts.map((alert) => ({
    reason: describeAlertReason({
      attribute_checked: alert.attribute,
      previous_value: alert.previousValue,
      new_value: alert.newValue,
    }),
    link: `${siteUrl}/alerts/${alert.id}`,
  }));

  const intro =
    alerts.length === 1
      ? `${vendorName} has a new critical alert:`
      : `${vendorName} has ${alerts.length} new critical alerts:`;

  const text = [intro, "", ...items.map(({ reason, link }) => `- ${reason}\n  ${link}`)].join("\n");

  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    "<ul>",
    ...items.map(
      ({ reason, link }) =>
        `<li>${escapeHtml(reason)} <a href="${escapeHtml(link)}">View alert</a></li>`,
    ),
    "</ul>",
  ].join("\n");

  return { subject, html, text };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/integrations/notifications/build-critical-alert-email.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/notifications/build-critical-alert-email.ts src/integrations/notifications/build-critical-alert-email.test.ts
git commit -m "feat(notifications): add pure critical-alert digest email builder"
```

---

### Task 3: Send email via Resend

**Files:**
- Create: `src/integrations/notifications/send-critical-alert-email.server.ts`
- Test: `src/integrations/notifications/send-critical-alert-email.server.test.ts`

**Interfaces:**
- Produces: `SendEmailInput`, `SendEmailOptions`, `SendEmailResult`, and `sendCriticalAlertEmail(input: SendEmailInput, options?: SendEmailOptions): Promise<SendEmailResult>`. Task 5 calls this directly as the `sendEmail` dependency for Task 4's orchestrator.
- Reads `process.env["RESEND_API_KEY"]` and `process.env["RESEND_FROM_EMAIL"]` by default (both overridable via `options` for tests). Provisioned in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src/integrations/notifications/send-critical-alert-email.server.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";

import { sendCriticalAlertEmail } from "./send-critical-alert-email.server";

// A fetch stub that returns a preset response and records the request,
// mirroring companies-house/provider.server.test.ts's stubFetch.
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const INPUT = {
  to: "owner@example.com",
  subject: "Critical alert: Acme Ltd",
  html: "<p>hi</p>",
  text: "hi",
};

const originalApiKey = process.env["RESEND_API_KEY"];
const originalFrom = process.env["RESEND_FROM_EMAIL"];

afterEach(() => {
  if (originalApiKey === undefined) delete process.env["RESEND_API_KEY"];
  else process.env["RESEND_API_KEY"] = originalApiKey;
  if (originalFrom === undefined) delete process.env["RESEND_FROM_EMAIL"];
  else process.env["RESEND_FROM_EMAIL"] = originalFrom;
});

describe("sendCriticalAlertEmail", () => {
  it("posts to the Resend API and returns ok on a 2xx response", async () => {
    const { fn, calls } = stubFetch(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));

    const result = await sendCriticalAlertEmail(INPUT, { apiKey: "test-key", fetchImpl: fn });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({ to: INPUT.to, subject: INPUT.subject, html: INPUT.html, text: INPUT.text });
  });

  it("returns ok: false with the response body on a non-2xx response", async () => {
    const { fn } = stubFetch(new Response(JSON.stringify({ message: "invalid from address" }), { status: 422 }));

    const result = await sendCriticalAlertEmail(INPUT, { apiKey: "test-key", fetchImpl: fn });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("422");
    expect(result.message).toContain("invalid from address");
  });

  it("returns ok: false when fetch itself throws (network error)", async () => {
    const { fn } = stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));

    const result = await sendCriticalAlertEmail(INPUT, { apiKey: "test-key", fetchImpl: fn });

    expect(result).toEqual({ ok: false, message: "ECONNREFUSED" });
  });

  it("returns ok: false without calling fetch when no API key is configured", async () => {
    delete process.env["RESEND_API_KEY"];
    const { fn, calls } = stubFetch(new Response("{}", { status: 200 }));

    const result = await sendCriticalAlertEmail(INPUT, { fetchImpl: fn });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/integrations/notifications/send-critical-alert-email.server.test.ts`
Expected: FAIL with "Cannot find module './send-critical-alert-email.server'"

- [ ] **Step 3: Implement `send-critical-alert-email.server.ts`**

Create `src/integrations/notifications/send-critical-alert-email.server.ts`:

```typescript
// Resend-backed email sender. No SDK dependency — calls Resend's REST API
// directly via fetch, matching how companies-house/client.ts talks to an
// external API. Server-only: reads process.env directly.

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Continuum Alerts <onboarding@resend.dev>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailOptions {
  apiKey?: string | undefined;
  from?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface SendEmailResult {
  ok: boolean;
  message?: string | undefined;
}

export async function sendCriticalAlertEmail(
  input: SendEmailInput,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const apiKey = options.apiKey ?? process.env["RESEND_API_KEY"];
  if (!apiKey) {
    return { ok: false, message: "RESEND_API_KEY is not configured" };
  }
  const from = options.from ?? process.env["RESEND_FROM_EMAIL"] ?? DEFAULT_FROM;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, message: `Resend responded ${response.status}: ${body}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/integrations/notifications/send-critical-alert-email.server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/notifications/send-critical-alert-email.server.ts src/integrations/notifications/send-critical-alert-email.server.test.ts
git commit -m "feat(notifications): add Resend-backed critical-alert email sender"
```

---

### Task 4: Orchestrate the send (pure, deps-injected)

**Files:**
- Create: `src/integrations/notifications/notify-critical-alerts.ts`
- Test: `src/integrations/notifications/notify-critical-alerts.test.ts`

**Interfaces:**
- Consumes: `CriticalAlertEmailItem`, `buildCriticalAlertEmail` from Task 2 (`./build-critical-alert-email`).
- Produces: `CriticalAlertItem` (alias of `CriticalAlertEmailItem` — see Step 3 note), `VendorInfo`, `NotifyCriticalAlertsDeps`, and `notifyCriticalAlerts(input: { vendorId: string; alerts: CriticalAlertItem[] }, deps: NotifyCriticalAlertsDeps): Promise<void>`. Task 5 builds the real `NotifyCriticalAlertsDeps` from Supabase + Task 3's sender and calls this function.

- [ ] **Step 1: Write the failing test**

Create `src/integrations/notifications/notify-critical-alerts.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/integrations/notifications/notify-critical-alerts.test.ts`
Expected: FAIL with "Cannot find module './notify-critical-alerts'"

- [ ] **Step 3: Implement `notify-critical-alerts.ts`**

Create `src/integrations/notifications/notify-critical-alerts.ts`:

```typescript
// Pure orchestrator: given a vendor and its newly-inserted critical alerts,
// resolve the recipient, build the email, and send it — all through
// injected deps, so this has no Node/Supabase/Resend imports of its own.
// See ./notify-critical-alerts.server.ts for the deps built from the real
// Supabase admin client + Resend sender.
//
// MUST NOT throw: every dependency call is wrapped so a failure anywhere in
// this path (vendor lookup, email lookup, send) is logged and swallowed,
// never propagated to the monitoring pipeline that calls this.

import { buildCriticalAlertEmail, type CriticalAlertEmailItem } from "./build-critical-alert-email";

export type CriticalAlertItem = CriticalAlertEmailItem;

export interface VendorInfo {
  companyName: string;
  ownerId: string;
}

export interface NotifyCriticalAlertsDeps {
  getVendor(vendorId: string): Promise<VendorInfo | null>;
  getOwnerEmail(ownerId: string): Promise<string | null>;
  sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ ok: boolean; message?: string | undefined }>;
  siteUrl: string;
}

export async function notifyCriticalAlerts(
  input: { vendorId: string; alerts: CriticalAlertItem[] },
  deps: NotifyCriticalAlertsDeps,
): Promise<void> {
  if (input.alerts.length === 0) return;

  try {
    const vendor = await deps.getVendor(input.vendorId);
    if (!vendor) {
      console.error("[notifications] vendor not found, skipping critical alert email", {
        vendorId: input.vendorId,
      });
      return;
    }

    const email = await deps.getOwnerEmail(vendor.ownerId);
    if (!email) {
      console.error("[notifications] owner has no email on file, skipping critical alert email", {
        vendorId: input.vendorId,
        ownerId: vendor.ownerId,
      });
      return;
    }

    const message = buildCriticalAlertEmail({
      vendorName: vendor.companyName,
      siteUrl: deps.siteUrl,
      alerts: input.alerts,
    });

    const result = await deps.sendEmail({ to: email, ...message });
    if (!result.ok) {
      console.error("[notifications] failed to send critical alert email", {
        vendorId: input.vendorId,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("[notifications] unexpected error sending critical alert email", {
      vendorId: input.vendorId,
      error,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/integrations/notifications/notify-critical-alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/integrations/notifications/notify-critical-alerts.ts src/integrations/notifications/notify-critical-alerts.test.ts
git commit -m "feat(notifications): add pure notify-critical-alerts orchestrator"
```

---

### Task 5: Wire it up — Supabase deps + hook into `monitor.server.ts`

**Files:**
- Create: `src/integrations/notifications/notify-critical-alerts.server.ts`
- Modify: `src/integrations/companies-house/monitor.server.ts`

**Interfaces:**
- Consumes: `notifyCriticalAlerts`, `CriticalAlertItem` (Task 4), `sendCriticalAlertEmail` (Task 3), `PersistedAlert` (Task 1).
- Produces: `notifyCriticalAlertsForVendor(db: AdminClient, vendorId: string, alerts: CriticalAlertItem[]): Promise<void>` — the one function `monitor.server.ts` calls.

This task has no dedicated test file, matching this codebase's existing convention: Supabase-touching wiring modules (`monitor.server.ts`, `scheduler.server.ts`) aren't unit tested directly — their logic was already proven pure in Tasks 1–4, and this task is pure wiring between already-tested pieces. Task 1's `monitor.test.ts` (with its fake store) already proves the call site behaves correctly; this task is verified via typecheck + the full existing suite, plus manual verification in Task 7.

- [ ] **Step 1: Create `notify-critical-alerts.server.ts`**

Create `src/integrations/notifications/notify-critical-alerts.server.ts`:

```typescript
// Server-only wiring: builds notify-critical-alerts.ts's deps from the
// Supabase service-role client (vendors table + auth.admin) and Resend
// (send-critical-alert-email.server.ts). Must ONLY be imported from server
// contexts, same rule as companies-house/monitor.server.ts.

import { notifyCriticalAlerts, type CriticalAlertItem } from "./notify-critical-alerts";
import { sendCriticalAlertEmail } from "./send-critical-alert-email.server";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/**
 * Vercel provides VERCEL_PROJECT_PRODUCTION_URL (no protocol, stable across
 * deploys) automatically — no setup required. Falls back to localhost for
 * local dev, where that env var isn't set.
 */
function resolveSiteUrl(): string {
  const productionUrl = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  return productionUrl ? `https://${productionUrl}` : "http://localhost:3000";
}

export async function notifyCriticalAlertsForVendor(
  db: AdminClient,
  vendorId: string,
  alerts: CriticalAlertItem[],
): Promise<void> {
  await notifyCriticalAlerts(
    { vendorId, alerts },
    {
      async getVendor(id) {
        const { data, error } = await db
          .from("vendors")
          .select("company_name,owner_id")
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return data ? { companyName: data.company_name, ownerId: data.owner_id } : null;
      },
      async getOwnerEmail(ownerId) {
        const { data, error } = await db.auth.admin.getUserById(ownerId);
        if (error) throw error;
        return data.user?.email ?? null;
      },
      sendEmail: (input) => sendCriticalAlertEmail(input),
      siteUrl: resolveSiteUrl(),
    },
  );
}
```

- [ ] **Step 2: Wire `monitor.server.ts`'s store to call it**

In `src/integrations/companies-house/monitor.server.ts`, add to the imports:

```typescript
import { notifyCriticalAlertsForVendor } from "../notifications/notify-critical-alerts.server";
```

and add `PersistedAlert` to the existing `import { ... } from "./monitor"` list.

Replace the `insertAlerts` method body inside `createSupabaseMonitoringStore` — change the final `.select("id")` to `.select("id,dedupe_key")` and the return statement, so the whole method reads:

```typescript
    async insertAlerts(records: AlertRecord[]): Promise<{ inserted: PersistedAlert[] }> {
      if (records.length === 0) return { inserted: [] };
      // Idempotent on dedupe_key: existing alerts for the same detected change
      // are ignored rather than duplicated. ignoreDuplicates means .select()
      // below only ever returns rows that were actually newly inserted.
      const { data, error } = await db
        .from("vendor_monitoring_alerts")
        .upsert(
          records.map((r) => ({
            vendor_id: r.vendorId,
            change_event_id: r.changeEventId,
            snapshot_id: r.snapshotId,
            source: r.source,
            attribute_checked: r.attribute,
            previous_value: r.previousValue,
            new_value: r.newValue,
            severity: r.severity,
            status: "open",
            checked_at: r.checkedAt,
            dedupe_key: r.dedupeKey,
          })),
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        )
        .select("id,dedupe_key");
      if (error) throw error;
      const recordsByKey = new Map(records.map((r) => [r.dedupeKey, r]));
      const inserted: PersistedAlert[] = (data ?? []).flatMap((row) => {
        const record = recordsByKey.get(row.dedupe_key);
        return record ? [{ ...record, id: row.id }] : [];
      });
      return { inserted };
    },

    async notifyCriticalAlerts(records: PersistedAlert[]): Promise<void> {
      if (records.length === 0) return;
      try {
        await notifyCriticalAlertsForVendor(db, records[0]!.vendorId, records);
      } catch (error) {
        // Belt-and-braces: notify-critical-alerts.ts already swallows its
        // own errors, but this store method must never let a defect there
        // regress the monitoring pipeline either.
        console.error("[notifications] notifyCriticalAlerts threw unexpectedly", {
          vendorId: records[0]?.vendorId,
          error,
        });
      }
    },
```

- [ ] **Step 3: Update `createNullStore`'s dry-run implementation**

In the same file, change:

```typescript
    async insertAlerts() {
      return { inserted: 0 };
    },
```

to:

```typescript
    async insertAlerts() {
      return { inserted: [] };
    },
    async notifyCriticalAlerts() {
      /* dry run: nothing sent */
    },
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

Run: `npm run test`
Expected: PASS — all existing tests plus the four new test files from Tasks 1–4.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/notifications/notify-critical-alerts.server.ts src/integrations/companies-house/monitor.server.ts
git commit -m "feat(notifications): wire critical-alert emails into the live Companies House check

createSupabaseMonitoringStore.insertAlerts now returns the persisted
alert rows (not just a count), and notifyCriticalAlerts sends a digest
via Resend when any of them are critical-severity. Two layers of error
swallowing (notify-critical-alerts.ts internally, and this store method
as a second guard) so a notification defect can never regress the
monitoring pipeline."
```

---

### Task 6: Provision Resend via the Vercel Marketplace

**Files:** none (provisioning + env only)

- [ ] **Step 1: Confirm the project is linked**

```bash
vercel link
```

Expected: confirms (or establishes) the link to the existing Vercel project — needed before `vercel integration add` can provision anything.

- [ ] **Step 2: Install the Resend integration**

```bash
vercel integration add resend/resend-email --yes
```

Expected: provisions Resend and adds `RESEND_API_KEY` to the project's environment variables automatically. If this step hands off to a browser/dashboard step (claiming the integration), stop and complete that manually before continuing.

- [ ] **Step 3: Verify a sending domain (or use Resend's shared test sender)**

Resend requires a verified sending domain before it will deliver to arbitrary recipients — until that's done, `onboarding@resend.dev` (this plan's `DEFAULT_FROM` fallback) only delivers to the Resend account owner's own verified email, which is sufficient for Step 4/Task 7's manual smoke test but not for real users. Verifying a real domain is an account-level DNS step outside this plan's scope — note it back to the user rather than attempting it here, since it requires access to the domain's DNS provider.

Once a domain is verified, set:

```bash
vercel env add RESEND_FROM_EMAIL
```

Expected: prompts for the value (e.g. `Continuum Alerts <alerts@yourdomain.com>`) and which environments to add it to.

- [ ] **Step 4: Pull the new env vars locally**

```bash
vercel env pull --yes
```

Expected: `.env.local` (or `.env`, per this repo's convention) now includes `RESEND_API_KEY` (and `RESEND_FROM_EMAIL` if Step 3 was completed).

- [ ] **Step 5: Commit if `vercel env pull` changed a tracked file**

Check whether the pulled env file is git-tracked in this repo (the existing `.env`/`.env.local` split suggests one may be gitignored and one may not be):

```bash
git status --short
```

If a tracked env file changed, commit it (env **names**, never real secret values, should be the only diff if the file is meant to be tracked — if actual secret values appear in a tracked file, stop and flag this back rather than committing). If nothing tracked changed, skip this step.

---

### Task 7: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Trigger a real check that produces a critical alert**

Using the local dev script or server function this codebase already has for running a manual Companies House check (check `src/integrations/companies-house/scheduler.server.ts`'s `runRecordedManualCompaniesHouseCheck` / the route that calls it for the exact invocation), run a check against a vendor whose Companies House record is `dissolved` or `liquidation` — the Companies House sandbox environment (`COMPANIES_HOUSE_ENV=sandbox`, already this repo's default) has test company numbers for exactly this; consult Companies House sandbox documentation for a dissolved-company test number, or temporarily point at a real dissolved company number in production mode if sandbox doesn't cover it.

- [ ] **Step 2: Confirm the email arrived**

Check the inbox of the Resend account's verified email (or the real recipient, if Task 6 Step 3's domain verification is done) for a "Critical alert: ..." email. Confirm:
- The link in the email opens the correct `/alerts/$alertId` page.
- The described change matches what's shown in the Alerts UI for that vendor.

- [ ] **Step 3: Confirm a non-critical change does NOT send an email**

Run a check that only produces an `attention` or `info` change (e.g. a company name change) against a different vendor. Confirm no email arrives, and confirm the check still completes normally (alert still visible in the Alerts UI) either way — this proves Task 1's severity filter and the "never regress the pipeline" guarantee both hold against the real store, not just the fake one.

- [ ] **Step 4: Record the result**

If both checks in Steps 2–3 pass: this plan's work is done — no further commit needed here, everything was already committed per-task in Tasks 1–6.

If either fails: **stop and treat it as a bug**, not something to patch ad hoc — go back to systematic-debugging on the specific mismatch (wrong recipient, broken link, email fired at the wrong severity, etc.), since every prior task was TDD'd and should not need behavior changes at this stage.

## Self-Review Notes

- **Spec coverage:** Digest-per-vendor-per-check (spec §1) → Task 1's filter + Task 2's multi-alert subject. Critical-only (spec Goal) → Task 1's `severity === "critical"` filter. Owner-only recipient via `auth.admin.getUserById` (spec Context) → Task 5's `getOwnerEmail`. Fire-and-forget/never-regress-pipeline (spec Error handling) → Task 1's interface contract + Task 4's internal try/catch + Task 5's belt-and-braces second catch. Resend via Marketplace, no SDK (spec §4, Global Constraints) → Task 3 (raw `fetch`) + Task 6 (CLI provisioning). Link to `/alerts/$alertId` (spec §2) → Task 2's `buildCriticalAlertEmail`.
- **No placeholders:** every step has literal, complete code. Task 6/7 have some inherently environment-dependent steps (domain verification, sandbox test company numbers) that can't be hardcoded — those are flagged as manual/out-of-scope explicitly, not left vague.
- **Type consistency:** `PersistedAlert` (Task 1) flows unchanged through Task 5's `monitor.server.ts` wiring and Task 5's `notify-critical-alerts.server.ts` call (`records[0]!.vendorId`, spread into `CriticalAlertItem`-shaped objects since `PersistedAlert` structurally satisfies `CriticalAlertItem`'s `{ id, attribute, previousValue, newValue }` fields). `CriticalAlertItem` (Task 4) is a type alias of `CriticalAlertEmailItem` (Task 2), not a duplicate shape, so no drift risk between the two.
- **Scope check:** single subsystem (one notification path, one severity, one recipient type) — no decomposition needed.
