// Types for the alert resolution workflow (ERD §22). Kept free of
// Node/Supabase imports so the orchestration in ./resolve-alert.ts stays a
// pure, dependency-free function usable from server code and unit tests
// alike — the Supabase-backed AlertResolutionStore lives in
// ./resolve-alert.server.ts (client.ts / client.server.ts split used
// elsewhere in this codebase).

/** Mirrors alerts.resolution_type (docs/database-design.md §8). */
export type ResolutionType = "verified_accepted" | "false_positive" | "risk_accepted";

/** Mirrors audit_events.actor_type (docs/database-design.md §9). */
export type ActorType = "user" | "system" | "service";

export interface ResolutionActor {
  id: string;
  type: ActorType;
}

export interface ResolveAlertInput {
  alertId: string;
  resolutionType: ResolutionType;
  /** Required for every resolution type (ERD §22: "Record reason" appears under all three). */
  reason: string;
  actor: ResolutionActor;
  /**
   * risk_accepted only: who owns the accepted exception (ERD §22 "Record
   * owner"). Defaults to `actor.id` when omitted — the person accepting the
   * risk is the owner unless someone else is named.
   */
  ownerId?: string | undefined;
  /** risk_accepted only: optional expiry for the exception (ERD §22 "Optional expiry date"). */
  expiresAt?: string | undefined;
}

export interface AlertRecord {
  id: string;
  organisationId: string;
  vendorId: string;
  changeEventId: string;
  status: "open" | "investigating" | "resolved";
}

export interface ChangeEventRecord {
  id: string;
  vendorId: string;
  provider: string;
  attributeKey: string;
  newValue: unknown;
  status: "open" | "resolved";
}

/**
 * Storage boundary for the resolution workflow. `upsertTrustProfileAttribute`
 * is the one write that must NEVER be called for false_positive or
 * risk_accepted — that's what makes "false positives do not change the
 * baseline" a structural guarantee rather than a rule the caller has to
 * remember, mirrored by ../monitoring/snapshot-pipeline.ts's MonitoringRunStore
 * shape for the same reason.
 */
export interface AlertResolutionStore {
  getAlert(alertId: string): Promise<AlertRecord | null>;
  getChangeEvent(changeEventId: string): Promise<ChangeEventRecord | null>;

  /** Update alerts.status / resolution_type / resolved_by / resolved_at (+ assigned_to for risk_accepted). Never inserts a new row. */
  resolveAlert(input: {
    alertId: string;
    resolutionType: ResolutionType;
    reason: string;
    resolvedBy: string;
    resolvedAt: string;
    ownerId?: string | undefined;
    expiresAt?: string | undefined;
  }): Promise<void>;

  /** Flip change_events.status to 'resolved'. The detection fields themselves are never touched (write-once). */
  resolveChangeEvent(changeEventId: string): Promise<void>;

  /**
   * Upsert the vendor's Trust Profile with a verified new value. Only ever
   * called for `verified_accepted` (ERD §22 "Update Trust Profile with
   * verified new value").
   */
  upsertTrustProfileAttribute(input: {
    vendorId: string;
    attributeKey: string;
    value: unknown;
    source: string;
    verifiedAt: string;
    changeEventId: string;
  }): Promise<void>;

  /** Append an audit_events row (ERD §22 "Write audit event", every resolution type). */
  recordAuditEvent(input: {
    organisationId: string;
    vendorId: string;
    actor: ResolutionActor;
    eventType: string;
    entityId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export type ResolveAlertOutcome =
  | {
      status: "resolved";
      alertId: string;
      changeEventId: string;
      resolutionType: ResolutionType;
    }
  | { status: "not_found" }
  | { status: "already_resolved"; alertId: string }
  | { status: "invalid_input"; message: string };
