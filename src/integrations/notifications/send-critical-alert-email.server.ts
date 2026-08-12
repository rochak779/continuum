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
