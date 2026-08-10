// Supabase-backed AuditEventWriter (./types.ts). One INSERT, nothing else —
// deliberately: this file has no update/delete function, which is the
// application-level enforcement of "audit records are append-only through
// normal application behaviour" (the DB grants back this up independently:
// audit_events has no UPDATE/DELETE grant for any role at all).
//
// Server-only file (TanStack Start strips `.server.ts` from the client
// bundle, same convention as client.server.ts / snapshot-pipeline.server.ts).
//
// `audit_events` predates the generated Database types
// (supabase/migrations/20260810130000), so table access here is typed by
// hand against the migration's column list rather than
// `Database["public"]["Tables"]`; regenerate and switch over once the
// Supabase types are refreshed.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuditEventInput, AuditEventRecord, AuditEventWriter } from "./types";

// Untyped on purpose — see file header.
type AdminClient = SupabaseClient;

interface AuditEventRow {
  id: string;
  created_at: string;
}

export function createSupabaseAuditEventWriter(db: AdminClient): AuditEventWriter {
  return {
    async record(input: AuditEventInput): Promise<AuditEventRecord> {
      const { data, error } = await db
        .from("audit_events")
        .insert({
          organisation_id: input.organisationId,
          vendor_id: input.vendorId,
          actor_type: input.actor.type,
          actor_id: input.actor.id,
          event_type: input.eventType,
          entity_type: input.entityType,
          entity_id: input.entityId,
          metadata: (input.metadata ?? {}) as never,
        } as never)
        .select("id, created_at")
        .single();

      if (error) throw error;
      const row = data as AuditEventRow;
      return { id: row.id, createdAt: row.created_at };
    },
  };
}
