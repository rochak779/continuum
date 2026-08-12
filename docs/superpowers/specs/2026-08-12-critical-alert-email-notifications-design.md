# Critical-alert email notifications — Design

Date: 2026-08-12
Status: Approved

## Context

Alerts and expiries only surface today if someone opens the dashboard.
`vendor_monitoring_alerts.severity` already carries a real, well-defined
`critical | attention | info` classification from the materiality engine
(`src/integrations/materiality/types.ts`) — so "what counts as critical"
needs no new modeling, it's already produced by the pipeline.

The product has no multi-tenancy yet (every table is scoped to a single
`owner_id`), so there is exactly one person to notify per vendor: its owner.
The owner's email lives only on Supabase `auth.users`, not `profiles`
(`profiles` has no `email` column) — reachable via the service-role client
already used elsewhere (`src/integrations/supabase/client.server.ts`, the
same pattern `record-audit-event.server.ts` follows).

## Goal

When a monitoring check inserts one or more genuinely new `critical`
alerts for a vendor, email the vendor's owner a digest describing what
changed, with a link to each alert.

## Non-goals

- Notification-preferences UI or opt-out. The owner is always emailed on a
  new critical alert in this pass — there's exactly one recipient and
  critical is already the threshold for "worth interrupting someone for."
- Email for `attention` / `info` severity alerts, or for document
  expiries. Separate future features if wanted; out of scope here.
- Multi-recipient / role-based delivery. When multi-tenant orgs land, the
  recipient-resolution step in `notify-critical-alerts.server.ts` is the
  one place that changes — the trigger point and email content don't.
- Any other delivery channel (Slack, SMS). See the discovery note this
  spec's design conversation already ran: Resend was the only relevant
  Vercel Marketplace `messaging` provider, and the recipient identity
  (email) already exists in the data model with no new connection UI
  required, unlike Slack.

## Design

### 1. Widen `insertAlerts`'s return shape

`src/integrations/companies-house/monitor.server.ts`'s `insertAlerts`
currently upserts alert rows (`onConflict: "dedupe_key", ignoreDuplicates:
true`) and returns only `{ inserted: number }`, discarding the `.select("id")`
result's actual rows. Because of `ignoreDuplicates`, that `.select` only
ever returns rows that were **actually inserted** — i.e. genuinely new
alerts, not alerts a recheck re-touched. Widen the return to
`{ inserted: AlertRecord[] }` (the full records, not just ids) so the
caller can filter by severity without a second query. Update
`AlertMonitoringStore`'s interface and the dry-run implementation
alongside it.

### 2. New module: `src/integrations/notifications/`

Following the `client.ts` / `client.server.ts` split already used
throughout this codebase (pure logic vs. Supabase/network-touching code):

- **`build-critical-alert-email.ts`** — pure. Input: vendor name + a list
  of `{ attribute, previousValue, newValue, alertId }`. Output:
  `{ subject, html, text }`. One email per vendor per check (a check is
  always single-vendor, so "digest per check" and "digest per vendor" are
  the same grouping). Per-item content: attribute label (reuse
  `alertAttributeLabel` from `src/lib/alert-labels.ts` for the same
  wording as the Alerts UI), previous → new value, and a link to
  `/alerts/$alertId`.
- **`send-critical-alert-email.server.ts`** — Resend-backed sender. Takes
  `{ to, subject, html, text }`, calls the Resend API.
- **`notify-critical-alerts.server.ts`** — orchestrator. Input:
  `{ ownerId, vendorId, vendorName, alerts: AlertRecord[] }`. Steps:
  1. Resolve the owner's email via
     `supabaseAdmin.auth.admin.getUserById(ownerId)`.
  2. If no email is found, log and return — no throw.
  3. Build the digest via `build-critical-alert-email.ts`.
  4. Send via `send-critical-alert-email.server.ts`.
  5. Any error from steps 1/3/4 is caught, logged server-side
     (`console.error` with vendor/owner context, matching the logging
     level already used for monitoring failures), and swallowed — never
     rethrown.

### 3. Hook point: `runVendorCheck` in `monitor.server.ts`

After `insertAlerts` returns, filter the inserted records for
`severity === "critical"`. If the filtered list is non-empty, call
`notifyCriticalAlerts({ ownerId, vendorId, vendorName, alerts })`,
**awaited**, wrapped in its own try/catch at the call site as a second
layer of defense (belt-and-braces on top of step 2.5's internal
swallowing) so a bug in the notification path can never change
`runVendorCheck`'s return value (`alertsCreated`, `status`, etc.) or
propagate to the caller.

This is "fire-and-forget" in effect, not literally undetached: an
un-awaited promise can be killed once a Vercel function's response
returns, so the send is awaited — its *outcome* is just never allowed to
affect the check's result.

### 4. Resend provisioning

Not part of this spec's build — happens at implementation time via
`vercel integration add resend/resend-email --yes`, including sender
domain verification. `send-critical-alert-email.server.ts` reads its API
key from the env var the integration provisions.

## Data flow

1. `runVendorCheck` runs the existing Fetch → Normalise → Snapshot →
   Compare → Classify → Alert pipeline, unchanged through alert
   classification.
2. `insertAlerts` upserts alert rows; returns the subset that was
   genuinely newly inserted (not re-touched duplicates).
3. `runVendorCheck` filters that subset for `severity === "critical"`.
4. If non-empty: `notifyCriticalAlerts(...)` resolves the owner's email,
   builds one digest (all new critical alerts from this check), sends it.
5. Any failure anywhere in 4 is logged and swallowed. `runVendorCheck`'s
   return value is identical whether the email sent, failed, or was never
   attempted.

## Error handling

- No owner email on the auth record → log, skip send, no throw.
- Resend API error (network, rate limit, invalid key) → log, skip, no
  throw.
- Both are swallowed at two levels (inside the orchestrator, and again at
  the `runVendorCheck` call site) so a defect in the notification path
  cannot regress the monitoring pipeline itself — the same isolation
  guarantee `MonitoringRunStore` already gives failed *fetches* (they
  can't touch vendor health) extends here to failed *notifications* (they
  can't touch check results).

## Testing

- `build-critical-alert-email.ts`: pure unit tests — vendor + alert list
  in, subject/html/text out. No network, no Supabase.
- `notify-critical-alerts.server.ts`: tested with a fake email sender and
  a fake owner-email lookup (same DI pattern `MonitoringRunStore` uses for
  tests) — verifies: a send is attempted only when there's at least one
  critical alert, a missing email short-circuits without throwing, and a
  sender failure doesn't throw.
- `insertAlerts` return-shape change: update existing
  `monitor.server.ts`/`monitor.ts` tests to assert the new
  `{ inserted: AlertRecord[] }` shape and that non-critical alerts don't
  trigger a notification call.
