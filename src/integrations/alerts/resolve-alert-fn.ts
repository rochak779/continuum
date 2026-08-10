// TanStack Start server function that runs the alert resolution workflow
// (ERD §22) for one of the three resolution types.
//
// The handler runs server-side only; it dynamically imports the server-only
// Supabase-backed store so the service-role client never reaches the client
// bundle. Auth is enforced by the attachSupabaseAuth function middleware
// configured in src/start.ts; `actorId` is accepted explicitly here (same
// convention as ../companies-house/check.ts) pending that middleware
// threading the authenticated user id into server function context.

import { createServerFn } from "@tanstack/react-start";

import type { ResolutionType } from "./types";

export interface ResolveAlertFnInput {
  alertId: string;
  resolutionType: ResolutionType;
  reason: string;
  actorId: string;
  ownerId?: string | undefined;
  expiresAt?: string | undefined;
}

const RESOLUTION_TYPES: readonly ResolutionType[] = [
  "verified_accepted",
  "false_positive",
  "risk_accepted",
];

function validateInput(input: ResolveAlertFnInput): ResolveAlertFnInput {
  if (!input || typeof input.alertId !== "string" || !input.alertId) {
    throw new Error("alertId is required");
  }
  if (!RESOLUTION_TYPES.includes(input.resolutionType)) {
    throw new Error(`resolutionType must be one of ${RESOLUTION_TYPES.join(", ")}`);
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new Error("reason is required");
  }
  if (typeof input.actorId !== "string" || !input.actorId) {
    throw new Error("actorId is required");
  }
  return {
    alertId: input.alertId,
    resolutionType: input.resolutionType,
    reason: input.reason,
    actorId: input.actorId,
    ownerId: input.ownerId,
    expiresAt: input.expiresAt,
  };
}

export const resolveAlertFn = createServerFn({ method: "POST" })
  .validator(validateInput)
  .handler(async ({ data }) => {
    const { resolveAlert } = await import("./resolve-alert");
    const { createSupabaseAlertResolutionStore } = await import("./resolve-alert.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const store = createSupabaseAlertResolutionStore(supabaseAdmin);
    return resolveAlert(store, {
      alertId: data.alertId,
      resolutionType: data.resolutionType,
      reason: data.reason,
      actor: { id: data.actorId, type: "user" },
      ownerId: data.ownerId,
      expiresAt: data.expiresAt,
    });
  });
