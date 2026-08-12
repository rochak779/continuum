// src/integrations/assistant/store.server.ts
//
// Supabase-backed AssistantDataStore (./store.ts). Server-only: dynamically
// imported by chat.server.ts so no server-only code reaches the client
// bundle (same convention as resolve-alert.server.ts).
//
// All reads go through the caller's own RLS-scoped client (the same
// `context.supabase` pattern as checkVendorCompaniesHouseFn in
// ../companies-house/check.ts) -- tenant isolation is enforced by Postgres
// RLS, not by filtering in this file. searchVendorDocuments' RPC call
// additionally takes an explicit match_owner_id parameter for
// defense-in-depth and index-friendly filtering; it is always the
// authenticated caller's id, sourced from chat.server.ts, never from
// model-controlled input (see tools.ts).
//
// document_chunks and audit_events predate the generated Database types
// (supabase/migrations/20260811170000, 20260811180000) -- same convention
// as record-audit-event.server.ts: table access here is typed by hand.

import { google } from "@ai-sdk/google";
import { embed } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { calculateVendorHealth, type HealthAlert, type MonitoringStatus } from "@/lib/vendor-health";
import type {
  AssistantDataStore,
  DocumentChunkMatch,
  TrustProfileAttribute,
  VendorAlert,
  VendorAuditEvent,
  VendorChangeEvent,
  VendorSummary,
} from "./store";

// Untyped on purpose -- see file header.
type ScopedClient = SupabaseClient;

export function createSupabaseAssistantStore(db: ScopedClient): AssistantDataStore {
  return {
    async listVendors() {
      const { data: vendors, error: vendorsError } = await db
        .from("vendors")
        .select("id, company_name, category, country, risk_level, monitoring_status");
      if (vendorsError) throw vendorsError;

      const { data: alerts, error: alertsError } = await db
        .from("vendor_monitoring_alerts")
        .select("vendor_id, severity, status")
        .neq("status", "resolved");
      if (alertsError) throw alertsError;

      const alertsByVendor = new Map<string, HealthAlert[]>();
      for (const alert of (alerts ?? []) as Array<{ vendor_id: string; severity: string; status: string }>) {
        const list = alertsByVendor.get(alert.vendor_id) ?? [];
        list.push({ severity: alert.severity as HealthAlert["severity"], status: alert.status });
        alertsByVendor.set(alert.vendor_id, list);
      }

      return (
        (vendors ?? []) as Array<{
          id: string;
          company_name: string;
          category: string | null;
          country: string | null;
          risk_level: string | null;
          monitoring_status: string;
        }>
      ).map(
        (v): VendorSummary => ({
          id: v.id,
          companyName: v.company_name,
          category: v.category,
          country: v.country,
          riskLevel: v.risk_level,
          monitoringStatus: v.monitoring_status,
          health: calculateVendorHealth(v.monitoring_status as MonitoringStatus, alertsByVendor.get(v.id) ?? []),
        }),
      );
    },

    async getVendorTrustProfile(vendorId) {
      const { data, error } = await db
        .from("trust_profile_attributes")
        .select("attribute_key, current_value, source, confidence, verified_at")
        .eq("vendor_id", vendorId);
      if (error) throw error;

      return (
        (data ?? []) as Array<{
          attribute_key: string;
          current_value: unknown;
          source: string;
          confidence: string;
          verified_at: string;
        }>
      ).map(
        (row): TrustProfileAttribute => ({
          attributeKey: row.attribute_key,
          currentValue: row.current_value as TrustProfileAttribute["currentValue"],
          source: row.source,
          confidence: row.confidence,
          verifiedAt: row.verified_at,
        }),
      );
    },

    async getVendorChanges(vendorId, sinceDate) {
      let query = db
        .from("vendor_change_events")
        .select("id, vendor_id, attribute_key, previous_value, new_value, severity, status, detected_at, vendors(company_name)")
        .eq("vendor_id", vendorId)
        .order("detected_at", { ascending: false });
      if (sinceDate) query = query.gte("detected_at", sinceDate);

      const { data, error } = await query;
      if (error) throw error;

      return (
        (data as unknown as Array<{
          id: string;
          vendor_id: string;
          attribute_key: string;
          previous_value: unknown;
          new_value: unknown;
          severity: string;
          status: string;
          detected_at: string;
          vendors: { company_name: string } | null;
        }>) ?? []
      ).map(
        (row): VendorChangeEvent => ({
          id: row.id,
          vendorId: row.vendor_id,
          vendorName: row.vendors?.company_name ?? "Unknown vendor",
          attributeKey: row.attribute_key,
          previousValue: row.previous_value as VendorChangeEvent["previousValue"],
          newValue: row.new_value as VendorChangeEvent["newValue"],
          severity: row.severity,
          status: row.status,
          detectedAt: row.detected_at,
        }),
      );
    },

    async getOpenAlerts(severity, vendorId) {
      let query = db
        .from("vendor_monitoring_alerts")
        .select("id, vendor_id, attribute_checked, severity, status, detected_at, vendors(company_name)")
        .neq("status", "resolved")
        .order("detected_at", { ascending: false });
      if (severity) query = query.eq("severity", severity);
      if (vendorId) query = query.eq("vendor_id", vendorId);

      const { data, error } = await query;
      if (error) throw error;

      return (
        (data as unknown as Array<{
          id: string;
          vendor_id: string;
          attribute_checked: string;
          severity: string;
          status: string;
          detected_at: string;
          vendors: { company_name: string } | null;
        }>) ?? []
      ).map(
        (row): VendorAlert => ({
          id: row.id,
          vendorId: row.vendor_id,
          vendorName: row.vendors?.company_name ?? "Unknown vendor",
          attributeChecked: row.attribute_checked,
          severity: row.severity,
          status: row.status,
          detectedAt: row.detected_at,
        }),
      );
    },

    async getVendorAuditHistory(vendorId, sinceDate) {
      let query = db
        .from("audit_events")
        .select("id, vendor_id, event_type, entity_type, entity_id, created_at")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false });
      if (sinceDate) query = query.gte("created_at", sinceDate);

      const { data, error } = await query;
      if (error) throw error;

      return (
        (data ?? []) as Array<{
          id: string;
          vendor_id: string | null;
          event_type: string;
          entity_type: string;
          entity_id: string;
          created_at: string;
        }>
      ).map(
        (row): VendorAuditEvent => ({
          id: row.id,
          vendorId: row.vendor_id,
          eventType: row.event_type,
          entityType: row.entity_type,
          entityId: row.entity_id,
          createdAt: row.created_at,
        }),
      );
    },

    async searchVendorDocuments(query, vendorId, callerId) {
      const { embedding } = await embed({
        model: google.textEmbeddingModel("text-embedding-004"),
        value: query,
      });

      const { data, error } = await db.rpc("match_document_chunks", {
        query_embedding: embedding,
        match_owner_id: callerId,
        match_vendor_id: vendorId,
        match_count: 5,
      });
      if (error) throw error;

      return (
        (data ?? []) as Array<{
          vendor_id: string;
          vendor_name: string;
          file_name: string;
          content: string;
          similarity: number;
        }>
      ).map(
        (row): DocumentChunkMatch => ({
          vendorId: row.vendor_id,
          vendorName: row.vendor_name,
          fileName: row.file_name,
          content: row.content,
          similarity: row.similarity,
        }),
      );
    },
  };
}
