// Alert resolution workflow (ERD §22). Pure orchestration — no Node/Supabase
// imports here; the Supabase-backed AlertResolutionStore lives in
// ./resolve-alert.server.ts.
//
// Three resolution types, one shared spine:
//
//   1. Validate input (reason required for all three; risk_accepted-only
//      fields rejected on the other two).
//   2. Load the alert; refuse to resolve one that's missing or already
//      resolved (idempotent — resolving twice must never double-write
//      history or fire a second audit event).
//   3. Load its change event (need attribute_key/new_value for the Trust
//      Profile update, and it's the row that gets `status = 'resolved'`).
//   4. verified_accepted ONLY: upsert the Trust Profile with the verified
//      new value (ERD §22 "Update Trust Profile with verified new value").
//      false_positive and risk_accepted never call this — "false positives
//      do not change the baseline" and "preserve underlying detected
//      change" hold by construction, not by remembering to skip a step.
//   5. Resolve the alert (status -> 'resolved', resolution_type, reason,
//      resolved_by, resolved_at [+ assigned_to/resolution_expiry for
//      risk_accepted]) and the change event (status -> 'resolved').
//   6. Write an audit event (actor, timestamp, reason) — every path, no
//      exceptions.
//
// Nothing here ever mutates change_events.previous_value/new_value or any
// other write-once detection field, and nothing deletes an alert or change
// event row — resolution only ever adds a terminal status + a new
// audit_events row, so "preserve all history" holds regardless of which
// resolution type fired.

import type {
  AlertResolutionStore,
  ResolutionType,
  ResolveAlertInput,
  ResolveAlertOutcome,
} from "./types";

function validate(input: ResolveAlertInput): string | null {
  if (!input.reason || input.reason.trim().length === 0) {
    return "reason is required.";
  }
  if (input.resolutionType !== "risk_accepted") {
    if (input.expiresAt !== undefined) {
      return "expiresAt is only valid for resolutionType 'risk_accepted'.";
    }
    if (input.ownerId !== undefined) {
      return "ownerId is only valid for resolutionType 'risk_accepted'.";
    }
  }
  return null;
}

function auditEventType(resolutionType: ResolutionType): string {
  return `alert.resolved.${resolutionType}`;
}

export async function resolveAlert(
  store: AlertResolutionStore,
  input: ResolveAlertInput,
): Promise<ResolveAlertOutcome> {
  const validationError = validate(input);
  if (validationError) {
    return { status: "invalid_input", message: validationError };
  }

  const alert = await store.getAlert(input.alertId);
  if (!alert) {
    return { status: "not_found" };
  }
  if (alert.status === "resolved") {
    return { status: "already_resolved", alertId: alert.id };
  }

  const changeEvent = await store.getChangeEvent(alert.changeEventId);
  if (!changeEvent) {
    return { status: "not_found" };
  }

  const resolvedAt = new Date().toISOString();
  const ownerId =
    input.resolutionType === "risk_accepted" ? (input.ownerId ?? input.actor.id) : undefined;

  // Step 4 — the one branch point in the whole workflow: only
  // verified_accepted ever touches the Trust Profile.
  if (input.resolutionType === "verified_accepted") {
    await store.upsertTrustProfileAttribute({
      vendorId: changeEvent.vendorId,
      attributeKey: changeEvent.attributeKey,
      value: changeEvent.newValue,
      source: changeEvent.provider,
      verifiedAt: resolvedAt,
      changeEventId: changeEvent.id,
    });
  }

  await store.resolveAlert({
    alertId: alert.id,
    resolutionType: input.resolutionType,
    reason: input.reason,
    resolvedBy: input.actor.id,
    resolvedAt,
    ownerId,
    expiresAt: input.resolutionType === "risk_accepted" ? input.expiresAt : undefined,
  });

  await store.resolveChangeEvent(changeEvent.id);

  await store.recordAuditEvent({
    organisationId: alert.organisationId,
    vendorId: changeEvent.vendorId,
    actor: input.actor,
    eventType: auditEventType(input.resolutionType),
    entityId: alert.id,
    metadata: {
      changeEventId: changeEvent.id,
      attributeKey: changeEvent.attributeKey,
      resolutionType: input.resolutionType,
      reason: input.reason,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(input.resolutionType === "risk_accepted" && input.expiresAt !== undefined
        ? { expiresAt: input.expiresAt }
        : {}),
    },
  });

  return {
    status: "resolved",
    alertId: alert.id,
    changeEventId: changeEvent.id,
    resolutionType: input.resolutionType,
  };
}
