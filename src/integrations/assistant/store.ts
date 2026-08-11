// src/integrations/assistant/store.ts
//
// Data-access contract for the AI assistant's tools (ERD-adjacent, design
// spec §Tools). One interface, six methods -- same shape as MonitoringStore
// (../companies-house/monitor.ts) and AlertResolutionStore
// (../alerts/types.ts): pure business/filter logic in tools.ts is tested
// against an in-memory fake implementing this interface; store.server.ts
// implements it against real Supabase.

import type { VendorHealth } from "@/lib/vendor-health";
import type { Json } from "@/integrations/supabase/types";

export interface VendorSummary {
  id: string;
  companyName: string;
  category: string | null;
  country: string | null;
  riskLevel: string | null;
  monitoringStatus: string;
  health: VendorHealth;
}

export interface TrustProfileAttribute {
  attributeKey: string;
  currentValue: Json;
  source: string;
  confidence: string;
  verifiedAt: string;
}

export interface VendorChangeEvent {
  id: string;
  vendorId: string;
  vendorName: string;
  attributeKey: string;
  previousValue: Json;
  newValue: Json;
  severity: string;
  status: string;
  detectedAt: string;
}

export interface VendorAlert {
  id: string;
  vendorId: string;
  vendorName: string;
  attributeChecked: string;
  severity: string;
  status: string;
  detectedAt: string;
}

export interface VendorAuditEvent {
  id: string;
  vendorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface DocumentChunkMatch {
  vendorId: string;
  vendorName: string;
  fileName: string;
  content: string;
  similarity: number;
}

export interface AssistantDataStore {
  /** All of the caller's vendors, unfiltered -- filtering happens in tools.ts. */
  listVendors(): Promise<VendorSummary[]>;
  getVendorTrustProfile(vendorId: string): Promise<TrustProfileAttribute[]>;
  getVendorChanges(vendorId: string, sinceDate: string | null): Promise<VendorChangeEvent[]>;
  getOpenAlerts(severity: string | null, vendorId: string | null): Promise<VendorAlert[]>;
  getVendorAuditHistory(vendorId: string, sinceDate: string | null): Promise<VendorAuditEvent[]>;
  /** callerId is always the authenticated user's id -- see tools.ts. */
  searchVendorDocuments(query: string, vendorId: string | null, callerId: string): Promise<DocumentChunkMatch[]>;
}
