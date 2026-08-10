import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

async function handleScheduledMonitoring(request: Request, env: unknown): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/monitoring/companies-house") return null;
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const environment = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
  const expected =
    (typeof environment["MONITORING_SCHEDULER_SECRET"] === "string"
      ? environment["MONITORING_SCHEDULER_SECRET"]
      : undefined) ?? process.env["MONITORING_SCHEDULER_SECRET"];
  if (!expected || request.headers.get("x-monitoring-secret") !== expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runScheduledCompaniesHouseMonitoring } =
    await import("./integrations/companies-house/scheduler.server");
  return Response.json(await runScheduledCompaniesHouseMonitoring());
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const monitoringResponse = await handleScheduledMonitoring(request, env);
      if (monitoringResponse) return monitoringResponse;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
