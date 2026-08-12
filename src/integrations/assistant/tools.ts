// src/integrations/assistant/tools.ts
//
// Pure business logic for the AI assistant's six tools (design spec
// §Tools). Each function validates its arguments, calls exactly one
// AssistantDataStore method, applies a row cap, and never throws --
// failures come back as { ok: false, error } so the calling model can tell
// the user something failed instead of the tool-call loop dying (design
// spec §Error handling).

import { z } from "zod";

import type {
  AssistantDataStore,
  DocumentChunkMatch,
  TrustProfileAttribute,
  VendorAlert,
  VendorAuditEvent,
  VendorChangeEvent,
  VendorSummary,
} from "./store";

const MAX_ROWS = 20;
export const MAX_CHUNKS = 5;

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

const uuid = z.string().uuid();

// listVendors ----------------------------------------------------------

const listVendorsArgsSchema = z.object({
  health: z.enum(["healthy", "attention_required", "critical", "monitoring_issue"]).optional(),
  category: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
});
export type ListVendorsArgs = z.infer<typeof listVendorsArgsSchema>;

export async function listVendors(
  store: AssistantDataStore,
  args: ListVendorsArgs,
): Promise<ToolResult<VendorSummary[]>> {
  const parsed = listVendorsArgsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Invalid arguments for listVendors." };

  try {
    const vendors = await store.listVendors();
    const filtered = vendors.filter((v) => {
      if (parsed.data.health && v.health !== parsed.data.health) return false;
      if (parsed.data.category && v.category?.toLowerCase() !== parsed.data.category.toLowerCase()) return false;
      if (parsed.data.search && !v.companyName.toLowerCase().includes(parsed.data.search.toLowerCase())) return false;
      return true;
    });
    return { ok: true, data: filtered.slice(0, MAX_ROWS) };
  } catch {
    return { ok: false, error: "Could not load vendors." };
  }
}

// getVendorTrustProfile -------------------------------------------------

const getVendorTrustProfileArgsSchema = z.object({ vendorId: uuid });
export type GetVendorTrustProfileArgs = z.infer<typeof getVendorTrustProfileArgsSchema>;

export async function getVendorTrustProfile(
  store: AssistantDataStore,
  args: GetVendorTrustProfileArgs,
): Promise<ToolResult<TrustProfileAttribute[]>> {
  const parsed = getVendorTrustProfileArgsSchema.safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: "Invalid arguments for getVendorTrustProfile: vendorId must be a UUID." };
  }

  try {
    const attributes = await store.getVendorTrustProfile(parsed.data.vendorId);
    return { ok: true, data: attributes };
  } catch {
    return { ok: false, error: "Could not load the vendor's trust profile." };
  }
}

// getVendorChanges -------------------------------------------------------

const getVendorChangesArgsSchema = z.object({
  vendorId: uuid,
  sinceDate: z.string().datetime().optional(),
});
export type GetVendorChangesArgs = z.infer<typeof getVendorChangesArgsSchema>;

export async function getVendorChanges(
  store: AssistantDataStore,
  args: GetVendorChangesArgs,
): Promise<ToolResult<VendorChangeEvent[]>> {
  const parsed = getVendorChangesArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid arguments for getVendorChanges: vendorId must be a UUID and sinceDate (if given) an ISO datetime.",
    };
  }

  try {
    const changes = await store.getVendorChanges(parsed.data.vendorId, parsed.data.sinceDate ?? null);
    return { ok: true, data: changes.slice(0, MAX_ROWS) };
  } catch {
    return { ok: false, error: "Could not load change history for this vendor." };
  }
}

// getOpenAlerts ------------------------------------------------------------

const getOpenAlertsArgsSchema = z.object({
  severity: z.enum(["critical", "attention", "info"]).optional(),
  vendorId: uuid.optional(),
});
export type GetOpenAlertsArgs = z.infer<typeof getOpenAlertsArgsSchema>;

export async function getOpenAlerts(
  store: AssistantDataStore,
  args: GetOpenAlertsArgs,
): Promise<ToolResult<VendorAlert[]>> {
  const parsed = getOpenAlertsArgsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Invalid arguments for getOpenAlerts." };

  try {
    const alerts = await store.getOpenAlerts(parsed.data.severity ?? null, parsed.data.vendorId ?? null);
    return { ok: true, data: alerts.slice(0, MAX_ROWS) };
  } catch {
    return { ok: false, error: "Could not load open alerts." };
  }
}

// getVendorAuditHistory ------------------------------------------------

const getVendorAuditHistoryArgsSchema = z.object({
  vendorId: uuid,
  sinceDate: z.string().datetime().optional(),
});
export type GetVendorAuditHistoryArgs = z.infer<typeof getVendorAuditHistoryArgsSchema>;

export async function getVendorAuditHistory(
  store: AssistantDataStore,
  args: GetVendorAuditHistoryArgs,
): Promise<ToolResult<VendorAuditEvent[]>> {
  const parsed = getVendorAuditHistoryArgsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Invalid arguments for getVendorAuditHistory." };

  try {
    const events = await store.getVendorAuditHistory(parsed.data.vendorId, parsed.data.sinceDate ?? null);
    return { ok: true, data: events.slice(0, MAX_ROWS) };
  } catch {
    return { ok: false, error: "Could not load audit history for this vendor." };
  }
}

// searchVendorDocuments -------------------------------------------------

const searchVendorDocumentsArgsSchema = z.object({
  query: z.string().min(1),
  vendorId: uuid.optional(),
});
export type SearchVendorDocumentsArgs = z.infer<typeof searchVendorDocumentsArgsSchema>;

/**
 * callerId is always the authenticated user's id, threaded in from the
 * route handler (chat.server.ts) -- never taken from `args`, which is
 * model-controlled tool-call input. searchVendorDocumentsArgsSchema has no
 * ownerId/userId field at all, so the model has no way to even attempt to
 * supply one (design spec §Guardrails).
 */
export async function searchVendorDocuments(
  store: AssistantDataStore,
  args: SearchVendorDocumentsArgs,
  callerId: string,
): Promise<ToolResult<DocumentChunkMatch[]>> {
  const parsed = searchVendorDocumentsArgsSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: "Invalid arguments for searchVendorDocuments: query is required." };

  try {
    const matches = await store.searchVendorDocuments(parsed.data.query, parsed.data.vendorId ?? null, callerId);
    return { ok: true, data: matches.slice(0, MAX_CHUNKS) };
  } catch {
    return { ok: false, error: "Could not search vendor documents." };
  }
}
