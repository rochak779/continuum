// Canonical audit_events.event_type vocabulary (ERD §13). event_type stays
// an unconstrained `text` column at the DB level (docs/database-design.md
// §0.2 — provider/workflow vocabularies that must stay open don't get a
// CHECK constraint), but the application should still write one consistent
// string per lifecycle action rather than each call site inventing its own.
// This module is that single source of truth.
//
// Only the ERD §13 "Examples" list. Do not add event types here that no
// code path actually emits yet — an unused constant just invites a caller
// to believe an action is audited when it isn't.

export const AUDIT_EVENT_TYPES = {
  VENDOR_CREATED: "vendor_created",
  IDENTIFIER_ADDED: "identifier_added",
  MONITORING_STARTED: "monitoring_started",
  MONITORING_FAILED: "monitoring_failed",
  BASELINE_CREATED: "baseline_created",
  CHANGE_DETECTED: "change_detected",
  ALERT_CREATED: "alert_created",
  ALERT_ASSIGNED: "alert_assigned",
  ALERT_RESOLVED: "alert_resolved",
  TRUST_PROFILE_UPDATED: "trust_profile_updated",
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];
