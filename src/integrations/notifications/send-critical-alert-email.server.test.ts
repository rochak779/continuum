import { afterEach, describe, expect, it } from "vitest";

import { sendCriticalAlertEmail } from "./send-critical-alert-email.server";

// A fetch stub that returns a preset response and records the request,
// mirroring companies-house/provider.server.test.ts's stubFetch.
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(url) } : { url: String(url), init });
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
