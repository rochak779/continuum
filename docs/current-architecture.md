# Continuum — Current Architecture

This document describes the implemented system as of 2026-08-10. `ERD.md` is
the product/domain design; this file records the deployed code and schema.

## Application and tenancy

Continuum is a TanStack Start/React application backed by Supabase. Vendors are
currently tenant-scoped to an individual Supabase user through
`vendors.owner_id`; organisation membership is not implemented yet. Browser
queries use the publishable-key client and Row Level Security. Service-role
access is confined to `*.server.ts` modules and the custom server entry.

Every monitoring table visible to users has RLS enabled and an owner policy
that resolves ownership through `vendors.owner_id`:

- `vendor_company_snapshots`
- `trust_profile_attributes`
- `vendor_change_events`
- `vendor_monitoring_alerts`
- `vendor_monitoring_failures`
- `vendor_monitoring_config`
- `vendor_monitoring_runs`

The internal `monitoring_scheduler_leases` table also has RLS enabled but no
browser policy. Only the service role can access it.

## Companies House provider boundary

`src/integrations/companies-house/client.ts` is the only module that calls the
Companies House REST API. `src/integrations/companies-house/config.server.ts`
resolves which environment is used and which key/base URL pair to pass it:
`COMPANIES_HOUSE_ENV=production` uses `COMPANIES_HOUSE_API_KEY` against the
live API; anything else (including unset) defaults to sandbox, using
`COMPANIES_HOUSE_SANDBOX_API_KEY` against the Companies House sandbox API.
The key is sent as the Basic-auth username with a blank password. It is never
returned to the browser, stored in monitoring records, or logged.

The adapter:

- canonicalises and validates company numbers before network access;
- applies a ten-second timeout;
- maps authentication, not-found, rate-limit, 5xx, timeout, malformed-body,
  and network failures to a typed result;
- handles both seconds and HTTP-date `Retry-After` values;
- rejects successful HTTP responses whose company number does not match the
  request or whose core name/status fields are missing;
- returns a generic network error message so provider/client internals are not
  persisted as monitoring failure text.

Normalisation trims strings and address fields, removes empty/duplicate SIC
codes, and sorts SIC codes before comparison.

## Monitoring lifecycle

The pure orchestrator is `monitor.ts`; Supabase persistence is isolated in
`monitor.server.ts`.

1. A successful first check appends a raw/normalised snapshot and creates the
   Trust Profile baseline with source and verification time. It creates no
   change event or alert.
2. Later checks compare `company_status`, `company_name`,
   `registered_address`, and `sic_codes` against the current Trust Profile—not
   against the preceding observation.
3. Differences create append-only `vendor_change_events` linked to their
   evidence snapshot. Canonical deterministic keys plus a database unique
   constraint suppress repeated identical states.
4. Critical and Attention events create actionable alerts. Informational
   events remain historical only. Every new alert must link to both its event
   and evidence snapshot; a unique event link prevents duplicate alerts.
5. Verified acceptance runs through `verify_vendor_monitoring_alert`, an
   authenticated transactional database function. It checks ownership, locks
   the alert, updates the Trust Profile, and resolves the event and alert. The
   event's old/new values remain immutable evidence.
6. Provider failures append to `vendor_monitoring_failures`, write no snapshot
   or Trust Profile value, and set pipeline state to `failing`.

The manual server function uses bearer-token middleware, performs an
RLS-scoped vendor lookup, requires the requested company number to match the
vendor's stored monitored identifier, and acquires the same per-vendor running
run constraint as scheduled work before service-role monitoring code runs.

## Vendor health

Vendor health is computed, not stored:

- Healthy: monitoring current and no unresolved actionable alert.
- Attention Required: monitoring current with an unresolved Attention alert.
- Critical: monitoring current with an unresolved Critical alert.
- Monitoring Issue: monitoring is not current, including stale/failing states.

Monitoring Issue has precedence, so stale or failed evidence can never present
a vendor as Healthy or Critical. The dashboard queries vendors, unresolved
alerts, and recent material events and applies this domain calculation.

## Scheduled monitoring

Supabase Cron invokes `POST /api/monitoring/companies-house` every five minutes
through `pg_net`. The endpoint requires `MONITORING_SCHEDULER_SECRET`; its URL
and matching request secret are stored as Supabase Vault secrets named
`monitoring_app_url` and `monitoring_scheduler_secret`.

The scheduler:

- acquires an atomic database lease to prevent overlapping batches;
- renews that lease between vendors during long batches;
- recovers abandoned per-vendor runs after the lease timeout;
- selects at most 50 enabled, due configurations;
- enforces one running row per vendor/provider in the database;
- spaces requests by at least 500 ms (within the documented provider limit);
- retries network, timeout, availability, and 429 failures up to three times;
- honours reasonable `Retry-After` values and defers rather than sleeping for
  excessive delays, preventing tied-up workers/retry storms;
- catches failures per vendor so one vendor cannot abort the batch;
- records each scheduled run and advances its next-check time.

The manual check path remains separate and available.

## Data integrity and performance

Snapshots, change events, and monitoring failures are append-only through the
application. Trust Profile attributes are current state and change only during
baseline establishment or verified acceptance.

Important database enforcement includes:

- unique Trust Profile attribute per vendor/key;
- unique deterministic change-event key;
- unique alert per change event and deterministic alert key;
- required event/snapshot links for new alerts (legacy rows are retained via
  `NOT VALID` constraints);
- one running monitoring run per vendor/provider;
- one monitoring configuration per vendor/provider;
- indexed due configurations, unresolved alerts, recent material events,
  snapshots, failures, and stale/running jobs.

Alert creation is retry-healing: after event upsert, persisted event IDs are
read back before alert upsert. A crash after event insertion can therefore be
retried without duplicating the event and still create the missing alert.

## Secrets and operations

Required server-side secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `COMPANIES_HOUSE_ENV` (`"sandbox"` | `"production"`, defaults to sandbox)
- `COMPANIES_HOUSE_API_KEY` (production)
- `COMPANIES_HOUSE_SANDBOX_API_KEY` (sandbox)
- `MONITORING_SCHEDULER_SECRET`

Secrets must be configured in the deployment environment/Vault and never
committed. Earlier repository history reportedly contained environment values;
those credentials must remain rotated because deleting the current file does
not remove historical exposure.

## Verification

The automated suite covers client response mapping, normalisation, baseline
creation, no-change checks, single/multiple changes, deterministic dedupe,
material alert creation, provider failures, vendor health, scheduler overlap
and retry behavior, tenant-isolated verification, and the complete Active →
Liquidation → verified Trust Profile lifecycle with old evidence preserved.
