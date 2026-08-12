// src/integrations/assistant/build-ai-tools.ts
//
// Wires the pure tool functions (./tools.ts) into `ai` SDK tool()
// definitions bound to one request's store + caller id. Input schemas here
// are the actual contract the model calls against -- they intentionally
// have no ownerId/userId field (see tools.ts's searchVendorDocuments
// guardrail comment).

import { z } from "zod";
import { tool } from "ai";

import type { AssistantDataStore } from "./store";
import {
  getOpenAlerts,
  getVendorAuditHistory,
  getVendorChanges,
  getVendorTrustProfile,
  listVendors,
  searchVendorDocuments,
} from "./tools";

export function buildAssistantTools(store: AssistantDataStore, callerId: string) {
  return {
    listVendors: tool({
      description: "List the caller's vendors, optionally filtered by health, category, or a name search term.",
      inputSchema: z.object({
        health: z.enum(["healthy", "attention_required", "critical", "monitoring_issue"]).optional(),
        category: z.string().optional(),
        search: z.string().optional(),
      }),
      execute: (input) => listVendors(store, input),
    }),
    getVendorTrustProfile: tool({
      description: "Get the current accepted (Trust Profile) attributes for one vendor, by vendor id.",
      inputSchema: z.object({ vendorId: z.string().uuid() }),
      execute: (input) => getVendorTrustProfile(store, input),
    }),
    getVendorChanges: tool({
      description: "Get detected changes for one vendor, optionally only since a given ISO datetime.",
      inputSchema: z.object({
        vendorId: z.string().uuid(),
        sinceDate: z.string().datetime().optional(),
      }),
      execute: (input) => getVendorChanges(store, input),
    }),
    getOpenAlerts: tool({
      description: "Get unresolved alerts across the caller's vendors, optionally filtered by severity or vendor id.",
      inputSchema: z.object({
        severity: z.enum(["critical", "attention", "info"]).optional(),
        vendorId: z.string().uuid().optional(),
      }),
      execute: (input) => getOpenAlerts(store, input),
    }),
    getVendorAuditHistory: tool({
      description: "Get the audit history (actions taken) for one vendor, optionally only since a given ISO datetime.",
      inputSchema: z.object({
        vendorId: z.string().uuid(),
        sinceDate: z.string().datetime().optional(),
      }),
      execute: (input) => getVendorAuditHistory(store, input),
    }),
    searchVendorDocuments: tool({
      description: "Semantic search over the content of uploaded vendor documents, optionally scoped to one vendor.",
      inputSchema: z.object({
        query: z.string().min(1),
        vendorId: z.string().uuid().optional(),
      }),
      execute: (input) => searchVendorDocuments(store, input, callerId),
    }),
  };
}
