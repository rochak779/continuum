// Supabase-backed MonitoringRunStore (./snapshot-pipeline.ts).
//
// Server-only file (TanStack Start strips `.server.ts` from the client
// bundle, same convention as client.server.ts / provider.server.ts): the
// service-role Supabase client must never reach the client bundle.
//
// `monitoring_runs` and `external_snapshots` predate the generated
// Database types (supabase/migrations/20260810130000), so table access
// here is typed by hand against the migration's column list rather than
// `Database["public"]["Tables"]`; regenerate and switch over once the
// Supabase types are refreshed.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAuditEventWriter } from "../audit/record-audit-event.server";
import {
  RunAlreadyInProgressError,
  type InsertedRun,
  type InsertedSnapshot,
  type MonitoringRunStore,
  type TriggerType,
} from "./snapshot-pipeline";
import type { NormalizedSnapshot, ProviderError } from "./types";

// Postgres unique_violation.
const UNIQUE_VIOLATION = "23505";

// Untyped on purpose: `monitoring_runs` / `external_snapshots` aren't in the
// generated Database type yet (see file header), so this accepts the real
// `supabaseAdmin` client structurally rather than requiring its full type.
type AdminClient = SupabaseClient;

interface MonitoringRunRow {
  id: string;
}

interface ExternalSnapshotRow {
  id: string;
}

export function createSupabaseMonitoringRunStore(db: AdminClient): MonitoringRunStore {
  const auditWriter = createSupabaseAuditEventWriter(db);

  return {
    async startRun(input: {
      vendorId: string;
      provider: string;
      triggerType: TriggerType;
    }): Promise<InsertedRun> {
      const { data, error } = await db
        .from("monitoring_runs")
        .insert({
          vendor_id: input.vendorId,
          provider: input.provider,
          status: "running",
          trigger_type: input.triggerType,
        } as never)
        .select("id")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          throw new RunAlreadyInProgressError(input.vendorId, input.provider);
        }
        throw error;
      }

      return { id: (data as MonitoringRunRow).id };
    },

    async insertSnapshot(input: {
      vendorId: string;
      snapshot: NormalizedSnapshot;
      fetchStatus: "success" | "partial";
    }): Promise<InsertedSnapshot> {
      const { data, error } = await db
        .from("external_snapshots")
        .insert({
          vendor_id: input.vendorId,
          provider: input.snapshot.provider,
          normalized_data: input.snapshot.normalizedData as never,
          raw_data: input.snapshot.rawData as never,
          fetched_at: input.snapshot.fetchedAt,
          provider_reference: input.snapshot.providerReference ?? null,
          fetch_status: input.fetchStatus,
        } as never)
        .select("id")
        .single();

      if (error) throw error;
      return { id: (data as ExternalSnapshotRow).id };
    },

    async completeRun(
      input:
        | { runId: string; status: "success" | "partial"; snapshotId: string }
        | { runId: string; status: "failed"; error: ProviderError },
    ): Promise<void> {
      const patch =
        input.status === "failed"
          ? {
              status: "failed",
              completed_at: new Date().toISOString(),
              error_type: input.error.type,
              error_message: input.error.message,
            }
          : {
              status: input.status,
              completed_at: new Date().toISOString(),
              snapshot_id: input.snapshotId,
            };

      const { error } = await db
        .from("monitoring_runs")
        .update(patch as never)
        .eq("id", input.runId);

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
