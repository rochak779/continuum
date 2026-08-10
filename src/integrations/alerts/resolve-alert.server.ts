// Supabase-backed AlertResolutionStore (./resolve-alert.ts).
//
// Server-only file (TanStack Start strips `.server.ts` from the client
// bundle, same convention as client.server.ts / snapshot-pipeline.server.ts):
// the service-role Supabase client must never reach the client bundle.
//
// `alerts` / `change_events` / `trust_profile_attributes` / `audit_events`
// predate the generated Database types (supabase/migrations/20260810130000),
// so table access here is typed by hand against the migration's column list
// rather than `Database["public"]["Tables"]`; regenerate and switch over
// once the Supabase types are refreshed.
//
// No cross-table transaction: each write below is a separate round trip,
// same trade-off already noted in snapshot-pipeline.server.ts. A crash
// between steps 5 (resolveAlert) and 6 (recordAuditEvent) — the two
// Supabase writes each resolution makes — leaves the alert/change event
// resolved without an audit trail entry; acceptable for MVP, revisit with a
// Postgres function if it needs to be atomic.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAuditEventWriter } from "../audit/record-audit-event.server";
import type { AlertRecord, AlertResolutionStore, ChangeEventRecord, ResolutionType } from "./types";

// Untyped on purpose — see file header.
type AdminClient = SupabaseClient;

interface AlertRow {
  id: string;
  organisation_id: string;
  vendor_id: string;
  change_event_id: string;
  status: "open" | "investigating" | "resolved";
}

interface ChangeEventRow {
  id: string;
  vendor_id: string;
  provider: string;
  attribute_key: string;
  new_value: unknown;
  status: "open" | "resolved";
}

export function createSupabaseAlertResolutionStore(db: AdminClient): AlertResolutionStore {
  const auditWriter = createSupabaseAuditEventWriter(db);

  return {
    async getAlert(alertId: string): Promise<AlertRecord | null> {
      const { data, error } = await db
        .from("alerts")
        .select("id, organisation_id, vendor_id, change_event_id, status")
        .eq("id", alertId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      const row = data as AlertRow;
      return {
        id: row.id,
        organisationId: row.organisation_id,
        vendorId: row.vendor_id,
        changeEventId: row.change_event_id,
        status: row.status,
      };
    },

    async getChangeEvent(changeEventId: string): Promise<ChangeEventRecord | null> {
      const { data, error } = await db
        .from("change_events")
        .select("id, vendor_id, provider, attribute_key, new_value, status")
        .eq("id", changeEventId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      const row = data as ChangeEventRow;
      return {
        id: row.id,
        vendorId: row.vendor_id,
        provider: row.provider,
        attributeKey: row.attribute_key,
        newValue: row.new_value,
        status: row.status,
      };
    },

    async resolveAlert(input: {
      alertId: string;
      resolutionType: ResolutionType;
      reason: string;
      resolvedBy: string;
      resolvedAt: string;
      ownerId?: string | undefined;
      expiresAt?: string | undefined;
    }): Promise<void> {
      const patch: Record<string, unknown> = {
        status: "resolved",
        resolution_type: input.resolutionType,
        resolution_reason: input.reason,
        resolved_by: input.resolvedBy,
        resolved_at: input.resolvedAt,
      };
      if (input.ownerId !== undefined) patch["assigned_to"] = input.ownerId;
      if (input.expiresAt !== undefined) patch["resolution_expiry"] = input.expiresAt;

      const { error } = await db
        .from("alerts")
        .update(patch as never)
        .eq("id", input.alertId);
      if (error) throw error;
    },

    async resolveChangeEvent(changeEventId: string): Promise<void> {
      const { error } = await db
        .from("change_events")
        .update({ status: "resolved" } as never)
        .eq("id", changeEventId);
      if (error) throw error;
    },

    async upsertTrustProfileAttribute(input: {
      vendorId: string;
      attributeKey: string;
      value: unknown;
      source: string;
      verifiedAt: string;
      changeEventId: string;
    }): Promise<void> {
      const { error } = await db.from("trust_profile_attributes").upsert(
        {
          vendor_id: input.vendorId,
          attribute_key: input.attributeKey,
          current_value: input.value as never,
          source: input.source,
          confidence: "verified",
          verified_at: input.verifiedAt,
          updated_from_change_event_id: input.changeEventId,
        } as never,
        { onConflict: "vendor_id,attribute_key" },
      );
      if (error) throw error;
    },

    async recordAuditEvent(input): Promise<void> {
      await auditWriter.record({
        organisationId: input.organisationId,
        vendorId: input.vendorId,
        actor: input.actor,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
      });
    },
  };
}
