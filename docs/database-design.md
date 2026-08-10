# Continuum — Database Design

Target schema for the Continuum backend, derived from `ERD.md` and
`docs/current-architecture.md`. This document defines the **final tables** the
migrations should converge on. It does not contain migration SQL — see
`docs/current-architecture.md` §11 for the gap list between this design and
what exists today.

All tables live in `public`, use `uuid` primary keys (`default gen_random_uuid()`),
and follow the naming/timestamp conventions already established in the existing
migrations (`created_at timestamptz not null default now()`, `updated_at` +
`update_updated_at_column()` trigger where a row is genuinely mutable).

---

## 0. Design principles carried through every table

1. **Everything resolves to an organisation** (ERD §5.1). Every table below
   carries `organisation_id`, including tables that already reach an
   organisation indirectly through `vendor_id`. This is a deliberate
   denormalisation: it lets every RLS policy be a single check against
   `organisation_members` instead of a multi-hop join through `vendors` on
   every read. The trade-off is a value that must be set correctly once at
   insert and never changed — `organisation_id` on a child row is written by
   the server-side monitoring engine from `vendors.organisation_id` at
   creation time and is never updated afterwards. See §11 for the invariant
   this depends on.
2. **Provider vocabularies stay unconstrained; Continuum's own workflow
   vocabularies get `CHECK` constraints.** Columns whose values come from an
   external provider or describe a provider-specific concept
   (`provider`, `identifier_type`, `attribute_key`, `event_type`,
   `entity_type`, `snapshot_type`) are plain `text` with no `CHECK` — adding a
   new provider (GST, sanctions, MCA…) must never require a schema migration
   (ERD §3.2). Columns that describe a state machine Continuum itself owns
   (`severity`, `status`, `lifecycle_status`, `monitoring_status`,
   `trigger_type`, `resolution_type`, `verification_status`, `actor_type`) get
   `CHECK` constraints, because those values are read by application logic
   that must not silently accept an unrecognised state.
3. **Mutable current-state vs. append-only history is explicit per table.**
   Each table section below states which it is. Nothing that is
   append-only gets an `UPDATE` grant to `authenticated`; nothing that is
   mutable current-state loses its history, because history lives in a
   separate append-only table it points back to.
4. **Idempotency is enforced by the database, not just application code.**
   Every place the ERD requires "do not create duplicates" gets a real unique
   index (partial where appropriate), not just a check in code — mirroring
   the pattern already proven in the current `vendor_monitoring_alerts.dedupe_key`
   implementation.
5. **Vendor health is computed, not stored.** Per ERD §23, "Healthy /
   Attention / Critical / Monitoring Issue" is derived from
   `vendors.monitoring_status` plus open `alerts`, evaluated at query time
   (a view or an application-layer query), not persisted as a column. Storing
   it would create a second source of truth that drifts from the alerts it's
   supposed to summarise. `vendors.monitoring_status` (pipeline health) and
   vendor health (business-facing badge) are two different things — the
   former is one input to the latter, not a synonym for it.

---

## 1. Tenancy tables (prerequisites, not in the validation list but required by every table below)

### `organisations`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text not null` | |
| `country` | `text` | |
| `industry` | `text` | |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger-maintained |

Mutable current-state row. No history table — organisation identity edits
aren't a monitored/auditable domain concept in MVP (name/country/industry
changes, if ever needed, are covered by `audit_events` rather than a snapshot
table).

### `organisation_members`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` | |
| `role` | `text not null check (role in ('admin','procurement','vendor_risk','compliance','finance','viewer'))` | ERD §5.2 initial roles |
| `created_at` | `timestamptz not null default now()` | |

**Unique:** `(organisation_id, user_id)` — a user has exactly one role per
organisation. **Index:** `user_id` (a user's own membership lookup on every
request, e.g. inside RLS policies — this is the join every other table's RLS
policy performs). Mutable (`role` can change; row deleted on removal from the
org — no "membership history" table in MVP, `audit_events` covers "member
added/removed").

---

## 2. `vendors`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `legal_name` | `text not null` | |
| `display_name` | `text` | |
| `country_code` | `text` | ISO 3166-1 alpha-2 by convention, not `CHECK`-enforced in MVP |
| `category` | `text` | |
| `criticality` | `text check (criticality in ('low','medium','high','critical'))` | internal risk tiering, distinct from monitoring-derived severity |
| `internal_owner_id` | `uuid references auth.users(id) on delete set null` | replaces the current free-text `internal_owner`; nullable so removing a user doesn't delete the vendor |
| `source` | `text not null default 'manual' check (source in ('manual','csv','sap','coupa'))` | |
| `source_vendor_id` | `text` | external system's own ID for this vendor, e.g. SAP vendor code |
| `lifecycle_status` | `text not null default 'active' check (lifecycle_status in ('draft','active','inactive','archived'))` | |
| `monitoring_status` | `text not null default 'not_monitored' check (monitoring_status in ('not_monitored','baseline_pending','monitoring','stale','failing'))` | pipeline health, see §0.5 |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger-maintained |

**Unique:** `(organisation_id, source, source_vendor_id) WHERE source_vendor_id IS NOT NULL`
— prevents importing the same SAP/Coupa/CSV vendor into one organisation
twice. Manually-created vendors (`source_vendor_id IS NULL`) are exempt —
nothing to dedupe against.

**Indexes:** `organisation_id`; `(organisation_id, lifecycle_status)`;
`(organisation_id, monitoring_status)` (dashboard vendor-list filtering).

**Mutability:** mutable current-state row — this *is* "the organisation's
relationship with a vendor" (ERD §6), so it's expected to change
(`criticality` reassessed, `lifecycle_status` moved to `archived`, etc.).
No Companies-House-specific columns (`companies_house_number`,
`companies_house_status`, …) — that data lives in `vendor_identifiers` and
`trust_profile_attributes`/`external_snapshots`, which is the ERD §6
requirement this table exists specifically to satisfy and the one place the
current schema (`vendors.companies_house_number`) violates today.

**Organisation ownership:** direct — `organisation_id` is the row's own
tenancy key, not inherited.

---

## 3. `vendor_identifiers`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | denormalised from `vendor_id` per §0.1 |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `identifier_type` | `text not null` | e.g. `COMPANIES_HOUSE_NUMBER`, `GSTIN`, `CIN`, `VAT_NUMBER`, `LEI`, `SAP_VENDOR_ID`, `COUPA_SUPPLIER_ID` — open vocabulary, see §0.2 |
| `identifier_value` | `text not null` | |
| `country_code` | `text` | |
| `is_primary` | `boolean not null default false` | |
| `verification_status` | `text not null default 'unverified' check (verification_status in ('unverified','verified','invalid'))` | |
| `verified_at` | `timestamptz` | |
| `created_at` | `timestamptz not null default now()` | |

**Unique:** `(organisation_id, identifier_type, identifier_value)` — the
literal ERD §7 requirement ("prevent duplicate identifiers being incorrectly
attached to the same organisation/vendor context"). This also structurally
prevents one organisation from monitoring the same Companies House number
under two different vendor records by accident.

**Unique (partial):** `(vendor_id, identifier_type) WHERE is_primary` — at
most one primary identifier per type per vendor (a vendor can have two
`VAT_NUMBER`s on file, but only one can be primary for monitoring purposes).

**Index:** `vendor_id`.

**Mutability:** mostly immutable — `identifier_value` should never be edited
in place (if it was entered wrong, delete the row and insert a new one, so
any snapshots/change events that cited the old identifier remain
attributable to what was actually queried). `verification_status` /
`verified_at` are the only fields expected to change after insert.

**Validation against ERD:** satisfies §7 fully. Explicitly the table that
lets a new provider (GST, sanctions) be added to an existing vendor without
touching `vendors` — new row, same table, no migration.

---

## 4. `trust_profile_attributes`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `attribute_key` | `text not null` | e.g. `company_status`, `legal_name`, `registered_address`, `sic_codes`, `gst_status`, `sanctions_status` — open vocabulary |
| `current_value` | `jsonb not null` | |
| `source` | `text not null` | provider that supplied the currently-accepted value, e.g. `companies_house` |
| `confidence` | `text not null default 'verified' check (confidence in ('verified','provider_reported','unverified'))` | `verified` = a human accepted a change event; `provider_reported` = baseline established, never explicitly reviewed; `unverified` = reserved for future non-provider sources |
| `verified_at` | `timestamptz` | set when `confidence = 'verified'` |
| `updated_at` | `timestamptz not null default now()` | trigger-maintained |
| `updated_from_change_event_id` | `uuid references change_events(id) on delete set null` | evidence trail — see §0 mutability note below |

**Unique:** `(vendor_id, attribute_key)` — this is *the* current-state table
(ERD §8): one row per attribute per vendor, always holding "what the
organisation currently considers valid" (ERD §3.3). There is deliberately no
history in this table; history is `external_snapshots` (what was observed)
and `change_events` (what changed, when, and why) — this table only ever
holds the present.

**Index:** `vendor_id`; `organisation_id`.

**Mutability:** mutable current-state, by design — this table is
**overwritten** on `Verified / Accepted` alert resolution (ERD §22 step 2)
and **created but not overwritten** on first baseline (ERD §18 step 4). It
is never touched by a `False Positive` resolution (ERD §22: "Do not update
trusted baseline"). The old value is not lost when this row is overwritten
because it's already permanently recorded on the `change_events` row that
`updated_from_change_event_id` points to — that FK is what makes an
overwrite here non-destructive to history.

**Validation against ERD:** satisfies §8 and the §3.3 "current vs. history"
split — this table is explicitly *only* current state, which is why it can
be freely overwritten without violating the "historical information must not
be silently overwritten" rule (§3.3): the overwritten value isn't silently
lost, it's already durable in `change_events`.

---

## 5. `external_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `provider` | `text not null` | |
| `snapshot_type` | `text not null default 'profile'` | allows a provider to report more than one kind of payload later (e.g. `profile` vs. `filing_history`) without a new table |
| `normalized_data` | `jsonb not null` | |
| `raw_data` | `jsonb not null` | full provider payload, for audit; not exposed to the frontend (ERD §27) |
| `fetched_at` | `timestamptz not null` | when the provider generated/returned the data |
| `provider_reference` | `text` | e.g. the company number requested, or a provider request/correlation ID |
| `fetch_status` | `text not null default 'success' check (fetch_status in ('success','partial'))` | a genuinely failed fetch never reaches this table at all — see `monitoring_runs` |
| `created_at` | `timestamptz not null default now()` | when Continuum persisted it |

**Index:** `(vendor_id, provider, fetched_at desc)` — this is the query the
monitoring engine and the UI both run constantly ("get the latest snapshot
for this vendor/provider"). Also `organisation_id`.

**No unique constraint.** Snapshots are genuinely append-only fact records —
two identical, back-to-back successful fetches (e.g. a daily check that finds
no change) are both real observations and both get a row; that redundancy is
intentional, not a bug to dedupe away. What must never duplicate is the
*alert* raised from a change, which is enforced downstream on
`change_events`/`alerts`, not here. A snapshot is only ever written for a
**successful** fetch — a failed API call produces a `monitoring_runs` row
with `status = 'failed'` and no `external_snapshots` row, which is the DB-level
expression of ERD §3.4/§20 ("a failed monitoring attempt must never look
like a real company change").

**Mutability:** append-only. No `UPDATE`, no `DELETE` grant to
`authenticated`; only `INSERT`/`SELECT` (service role writes, org members
read their own).

**Validation against ERD:** satisfies §9 ("Snapshots should normally be
append-only") and the §3.4 failure-isolation requirement, by construction —
there is no code path that reaches this table on a failed fetch.

---

## 6. `monitoring_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `provider` | `text not null` | |
| `started_at` | `timestamptz not null default now()` | |
| `completed_at` | `timestamptz` | null while `status = 'running'` |
| `status` | `text not null default 'running' check (status in ('running','success','failed','partial','skipped'))` | |
| `error_type` | `text` | set when `status = 'failed'`; free text (mirrors the Companies House client's `CompaniesHouseErrorType` union, but this column stays a provider-agnostic string so other providers' error taxonomies fit without a migration) |
| `error_message` | `text` | |
| `snapshot_id` | `uuid references external_snapshots(id) on delete set null` | set only when `status = 'success'`/`'partial'` |
| `trigger_type` | `text not null check (trigger_type in ('manual','scheduled','retry','initial_baseline'))` | |
| `created_at` | `timestamptz not null default now()` | |

**Unique (partial):** `(vendor_id, provider) WHERE status = 'running'` — the
DB-level enforcement of ERD §24 ("do not run overlapping jobs"): a second
run for the same vendor/provider cannot be inserted while one is already in
flight. The scheduler's batch job must insert this row *before* calling the
provider and update it to a terminal status when the call returns; a crash
mid-run leaves a stuck `running` row, which is a known trade-off for MVP
(cleanup/timeout sweep is a scheduler-level concern, not a schema one — noted
here so it isn't lost).

**Index:** `(vendor_id, started_at desc)`; `(organisation_id, status)` for
the observability queries in ERD §29 ("did monitoring run, which vendor, did
it succeed").

**Mutability:** mutable — a row is inserted at `started_at` with
`status = 'running'` and updated once to a terminal status. This is the one
table in the design that is genuinely written twice per event (insert, then
update), which is correct: it's tracking an *attempt*, and the attempt's
outcome isn't known until the call returns.

**Validation against ERD:** satisfies §10 directly — this is the table that
separates "vendor has a problem" from "our monitoring attempt failed," and
gives ERD §29's observability questions a direct answer each.

---

## 7. `change_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `provider` | `text not null` | |
| `attribute_key` | `text not null` | |
| `previous_value` | `jsonb` | null for baseline-adjacent "first known value" cases only; normally set |
| `new_value` | `jsonb` | |
| `severity` | `text not null check (severity in ('critical','attention','info'))` | |
| `materiality_reason` | `text not null` | human-readable explanation, e.g. "Company status changed from Active to Liquidation" (ERD §21 example) |
| `recommended_action` | `text not null` | |
| `snapshot_id` | `uuid not null references external_snapshots(id) on delete restrict` | `restrict`, not `cascade` — a change event's evidence must never disappear out from under it |
| `detected_at` | `timestamptz not null default now()` | |
| `status` | `text not null default 'open' check (status in ('open','resolved'))` | mirrors whether the linked alert (if any) has been resolved; `'open'` for informational changes that never get an alert too, until the row is superseded by a newer detection of the same attribute |
| `dedupe_key` | `text not null` | deterministic, `vendor_id \| provider \| attribute_key \| previous_value \| new_value` — carried over from the current codebase's proven pattern |

**Unique:** `dedupe_key` — the DB-level enforcement of ERD §20 ("the system
must prevent duplicate change events for the same detected state"). If
Companies House reports `dissolved` on ten consecutive daily checks, only
the first check inserts a `change_events` row; the other nine are the same
transition (`active → dissolved` did not happen again — the *state* is
identical to the last recorded change) and are rejected by this constraint
at the database layer, not just skipped in application code.

**Index:** `(vendor_id, detected_at desc)`; `organisation_id`; `snapshot_id`.

**Mutability:** the detection fields (`attribute_key`, `previous_value`,
`new_value`, `severity`, `materiality_reason`, `snapshot_id`, `detected_at`)
are write-once — a change event is a factual record of what was detected and
must stay traceable to its evidence (ERD §11: "deterministic and traceable
back to its evidence"). Only `status` is mutable, flipped to `resolved` when
the linked alert (if one was created) is resolved, by the same transaction
that resolves the alert.

**Validation against ERD:** satisfies §11 and, via `dedupe_key`, §20. The
separation of `change_events` (fact) from `alerts` (actionable wrapper) is
what allows §12's "informational changes do not necessarily need alerts" —
an `info`-severity change event is written here for the historical record,
but the monitoring engine simply does not create a row in `alerts` for it.

---

## 8. `alerts`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `change_event_id` | `uuid not null references change_events(id) on delete restrict` | |
| `severity` | `text not null check (severity in ('critical','attention','info'))` | denormalised from `change_events.severity` for list/filter queries that shouldn't need a join |
| `status` | `text not null default 'open' check (status in ('open','investigating','resolved'))` | ERD §12 lifecycle |
| `assigned_to` | `uuid references auth.users(id) on delete set null` | |
| `title` | `text not null` | |
| `description` | `text not null` | |
| `recommended_action` | `text not null` | copied from `change_events.recommended_action` at creation time |
| `created_at` | `timestamptz not null default now()` | |
| `acknowledged_at` | `timestamptz` | |
| `resolved_at` | `timestamptz` | |
| `resolution_type` | `text check (resolution_type in ('verified_accepted','false_positive','risk_accepted'))` | ERD §12/§22 outcomes; null until resolved |
| `resolution_reason` | `text` | required by the app layer when `resolution_type` is set, not DB-enforced (keeps the constraint simple; app validates before calling the resolve endpoint) |
| `resolved_by` | `uuid references auth.users(id) on delete set null` | |
| `resolution_expiry` | `timestamptz` | optional, only meaningful for `resolution_type = 'risk_accepted'` (ERD §22: "Optional expiry date") |

**Unique:** `change_event_id` — one alert per change event, ever. Because
`change_events.dedupe_key` already guarantees at most one `change_events` row
per detected state, this transitively gives ERD §20's "prevent duplicate
open alerts for the same unresolved change" without needing a separate
partial-unique-on-open-status index. It also means an alert is never created
retroactively for an already-recorded change — the monitoring engine decides
whether to insert into `alerts` in the same transaction it inserts the
`change_events` row.

**Index:** `(organisation_id, status)`; `(vendor_id, status)`; `assigned_to`.

**Mutability:** mutable — `status`, `assigned_to`, `acknowledged_at`,
`resolved_at`, `resolution_*`, `resolved_by` all change over the alert's
lifecycle. `change_event_id`, `severity`, `title`, `description`,
`recommended_action`, `created_at` are set once and never edited (they're a
copy of the evidence at alert-creation time; if the underlying evidence needs
correcting, that's a new `change_events` row and a new alert, not an edit to
this one).

**Validation against ERD:** satisfies §12 and §22 end to end, including the
three distinct resolution branches — `verified_accepted` is the only
`resolution_type` whose handler also writes to `trust_profile_attributes`;
`false_positive` and `risk_accepted` close the alert without touching it,
matching §22's explicit "do not update trusted baseline" instruction for
false positives.

---

## 9. `audit_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid references vendors(id) on delete set null` | nullable — some audit events are organisation-level (e.g. member added), not vendor-scoped |
| `actor_type` | `text not null check (actor_type in ('user','system','service'))` | |
| `actor_id` | `uuid` | user id when `actor_type = 'user'`; null otherwise. No FK — deliberately: a user can be removed from an organisation (or deleted) and the audit trail must still show who acted, per ERD §13 "must not depend on application logs" — a `cascade`/`set null` FK would let history be silently altered or lost by an unrelated user-management action |
| `event_type` | `text not null` | `vendor_created`, `identifier_added`, `monitoring_started`, `monitoring_failed`, `baseline_created`, `change_detected`, `alert_created`, `alert_assigned`, `alert_resolved`, `trust_profile_updated`, … — open vocabulary |
| `entity_type` | `text not null` | `vendor`, `vendor_identifier`, `alert`, `change_event`, `trust_profile_attribute`, `monitoring_run`, `organisation_member`, … |
| `entity_id` | `uuid not null` | no FK — deliberately polymorphic (points at rows across several tables); referential integrity here is a correctness trade-off explicitly accepted in exchange for the append-only, log-independent guarantee ERD §13 asks for. Entity existence should be verified at write time by the code producing the event, not by the database at read time. |
| `metadata` | `jsonb not null default '{}'` | must never contain API keys/tokens/raw provider payloads (ERD §29) |
| `created_at` | `timestamptz not null default now()` | |

**Index:** `(organisation_id, created_at desc)`; `(entity_type, entity_id)`;
`(vendor_id, created_at desc) WHERE vendor_id IS NOT NULL`.

**No unique constraint.** Every action produces its own row; there is no
notion of a duplicate audit event to prevent (a vendor being created twice by
mistake is two real events, not a data-quality bug the table should mask).

**Mutability:** strictly append-only. `INSERT`/`SELECT` only — no `UPDATE`
grant to any role including `service_role` in normal operation (an audit log
that can be edited by the same process that writes it isn't one). No
`updated_at` column, on purpose.

**Validation against ERD:** satisfies §13 directly, including "must not
depend on application logs" — the deliberate lack of FKs on `actor_id`/
`entity_id` is what makes that guarantee hold even as related rows are
deleted or actors are removed from the organisation.

---

## 10. `vendor_monitoring_config`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `organisation_id` | `uuid not null references organisations(id) on delete cascade` | |
| `vendor_id` | `uuid not null references vendors(id) on delete cascade` | |
| `provider` | `text not null` | |
| `enabled` | `boolean not null default true` | |
| `frequency` | `interval not null default '24:00:00'` | ERD §14: "For the MVP, Companies House may use one default schedule" — modelled as a real interval rather than a text enum so the scheduler can do `next_check_at + frequency` arithmetic directly |
| `last_checked_at` | `timestamptz` | |
| `next_check_at` | `timestamptz` | |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger-maintained |

**Unique:** `(vendor_id, provider)` — one monitoring configuration per
vendor/provider pair.

**Index:** `(enabled, next_check_at)` — this is the scheduler's poll query
("which vendor/provider pairs are due"), and it needs to be fast across the
whole table, not scoped to one organisation at a time, so `organisation_id`
is not part of this index (it's still present on the row for RLS). A
secondary `organisation_id` index covers the settings-page use case
("show this org's monitoring config").

**Mutability:** mutable current-state — `enabled`, `frequency`,
`last_checked_at`, `next_check_at` are updated by the scheduler and by users
changing settings. No history table for config changes in MVP; config
changes are covered by `audit_events` if/when that's needed, not by a
separate config-history table.

**Validation against ERD:** satisfies §14. `next_check_at` plus the
`(enabled, next_check_at)` index is what makes ERD §24's "batch vendors" /
"respect rate limits" schedulable — the batch job selects
`WHERE enabled AND next_check_at <= now() LIMIT <rate-limit-budget>`, and
throttling is a matter of how large that `LIMIT` is per scheduler tick, not
a schema concern.

---

## 11. Relationships (text ER summary)

```
organisations 1──* organisation_members *──1 auth.users

organisations 1──* vendors
vendors        1──* vendor_identifiers
vendors        1──* trust_profile_attributes
vendors        1──* external_snapshots
vendors        1──* monitoring_runs
vendors        1──* change_events
vendors        1──* alerts
vendors        1──* vendor_monitoring_config
vendors        0..1─* audit_events        (nullable vendor_id)

external_snapshots 1──* monitoring_runs        (monitoring_runs.snapshot_id, nullable)
external_snapshots 1──* change_events          (change_events.snapshot_id, required)

change_events   1──0..1 alerts                 (alerts.change_event_id, unique)
change_events   0..* trust_profile_attributes  (trust_profile_attributes.updated_from_change_event_id, nullable)

auth.users 1──* vendors            (vendors.internal_owner_id, nullable)
auth.users 1──* alerts             (alerts.assigned_to / resolved_by, nullable)
auth.users 1──* audit_events       (audit_events.actor_id, no FK — see §9)
```

**Invariant every write path must preserve:** for any row `r` in
`vendor_identifiers`, `trust_profile_attributes`, `external_snapshots`,
`monitoring_runs`, `change_events`, `alerts`, or `vendor_monitoring_config`,
`r.organisation_id = (select organisation_id from vendors where id = r.vendor_id)`.
Vendors are not expected to move between organisations in MVP, so this only
needs to be true at insert time. It is not DB-enforced by a constraint in
this design (Postgres can't `CHECK` across tables without a trigger); a
`BEFORE INSERT` trigger that copies `organisation_id` from `vendors` instead
of trusting the caller is the recommended way to close this gap when writing
the actual migration, and should be treated as required, not optional
polish — RLS correctness depends on it.

---

## 12. Organisation ownership & RLS shape (for migration-writing time, not enacted here)

Every table above carries `organisation_id`. The RLS shape is uniform:

```sql
-- SELECT (all org-owned tables)
USING (organisation_id IN (
  SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
))

-- INSERT/UPDATE where end users write directly (e.g. vendors, vendor_identifiers,
-- alerts.status/assigned_to/resolution_*, vendor_monitoring_config)
WITH CHECK (organisation_id IN (
  SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
))
```

`external_snapshots`, `monitoring_runs`, `change_events`, and `audit_events`
get **no INSERT/UPDATE grant for `authenticated`** — only `service_role`
(the monitoring engine) writes them; org members get `SELECT` only. This is
the schema-level expression of ERD §27 ("service-role credentials never
reach the browser" combined with "sensitive actions are audit logged") —
those four tables can only be populated by server-side code that already
holds the service-role key, never by a client-side insert.

Role-based restriction *within* an organisation (e.g. only `admin`/
`vendor_risk` may resolve alerts) is deliberately left out of RLS policies
for MVP, per ERD §5.2 ("detailed role-based permissions can remain
lightweight for MVP") — RLS enforces the organisation boundary; finer role
checks belong in the server function that handles alert resolution, where
they're easier to test and change than a policy expression.

---

## 13. Summary: validation checklist

| Table | ERD section(s) | Append-only or mutable | Org-owned via |
|---|---|---|---|
| `vendors` | §6 | Mutable current-state | direct `organisation_id` |
| `vendor_identifiers` | §7 | Immutable identity + mutable verification fields | denormalised `organisation_id` |
| `trust_profile_attributes` | §8, §3.3 | Mutable current-state (overwrite-safe via `change_events` link) | denormalised `organisation_id` |
| `external_snapshots` | §9, §3.3, §3.4 | Append-only | denormalised `organisation_id` |
| `monitoring_runs` | §10, §3.4, §29 | Mutable (insert running → update terminal) | denormalised `organisation_id` |
| `change_events` | §11, §3.3, §20 | Write-once facts + mutable `status` | denormalised `organisation_id` |
| `alerts` | §12, §22, §23 | Mutable lifecycle over immutable evidence link | denormalised `organisation_id` |
| `audit_events` | §13 | Strictly append-only | denormalised `organisation_id` |
| `vendor_monitoring_config` | §14, §24 | Mutable current-state | denormalised `organisation_id` |

All nine tables satisfy the ERD's core invariant (§3.3): current state
(`vendors`, `trust_profile_attributes`, `vendor_monitoring_config`) is always
separable from history (`external_snapshots`, `change_events`,
`monitoring_runs`, `audit_events`), and the one workflow table that bridges
them (`alerts`) never mutates the evidence it points to — it only ever
mutates its own lifecycle fields.
