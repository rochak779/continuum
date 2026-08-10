// Types for the audit trail (ERD §13). Kept free of Node/Supabase imports —
// the Supabase-backed writer lives in ./record-audit-event.server.ts
// (client.ts / client.server.ts split used elsewhere in this codebase).

import type { AuditEventType } from "./event-types";

/** Mirrors audit_events.actor_type. */
export type AuditActorType = "user" | "system" | "service";

export interface AuditActor {
  /** Null for a system-initiated action with no associated user (e.g. a scheduled monitoring run). */
  id: string | null;
  type: AuditActorType;
}

export interface AuditEventInput {
  organisationId: string;
  /** Null only for organisation-level events with no single vendor (audit_events.vendor_id is nullable for this reason). */
  vendorId: string | null;
  actor: AuditActor;
  eventType: AuditEventType;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditEventRecord {
  id: string;
  createdAt: string;
}

/**
 * The entire audit-writing surface is one method: append a row. There is no
 * update/delete here and none should ever be added — that omission is what
 * makes the trail append-only through normal application behaviour, on top
 * of the DB grants already enforcing it (audit_events gets no UPDATE grant
 * for any role, not even service_role — supabase/migrations/20260810130000).
 */
export interface AuditEventWriter {
  record(input: AuditEventInput): Promise<AuditEventRecord>;
}
