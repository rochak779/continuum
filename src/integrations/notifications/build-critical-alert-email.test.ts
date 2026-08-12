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
