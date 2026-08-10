# Continuum — Engineering Requirements Document

## 1. Purpose

Continuum is a continuous vendor trust platform. It connects to existing vendor records, enriches them with external data, monitors important attributes for change, and alerts users when a material change requires action.

The MVP must prove one core workflow:

**Vendor → Trust Baseline → External Monitoring → Change Detection → Materiality → Alert → Resolution → Updated Trust Profile**

The first real external data integration will be the **UK Companies House API**.

---

# 2. MVP Engineering Scope

The backend must support:

- Multi-tenant organisations
- Vendor records
- Manual vendor addition
- CSV/imported vendors
- External vendor identifiers
- Vendor Trust Profiles
- External API integrations
- Historical monitoring snapshots
- Change detection
- Materiality classification
- Alerts
- Alert ownership and resolution
- Monitoring history
- Audit history
- Scheduled monitoring
- Frontend access to current vendor health and alerts

The MVP should be designed so additional providers such as GST, sanctions, insolvency, certifications, and other company registries can later be added without rewriting the monitoring engine.

---

# 3. Architecture Principles

### 3.1 Existing systems remain vendor sources

SAP, Coupa, CSV, and manual entry tell Continuum:

**“Who are our vendors?”**

External providers tell Continuum:

**“What is currently true about this vendor?”**

Continuum determines:

**“What changed, does it matter, and what should happen next?”**

---

### 3.2 Provider-independent architecture

Companies House must not be hardcoded throughout the application.

Every external data source should follow the same conceptual pattern:

**Fetch → Validate → Normalise → Snapshot → Compare → Classify → Alert**

This allows future providers to plug into the same monitoring framework.

---

### 3.3 Current state and history must be separate

Continuum must distinguish between:

**Current trusted state**  
What the organisation currently considers valid.

**External snapshot**  
What an external source reported at a particular point in time.

**Change event**  
The difference detected between trusted/current information and newly observed information.

**Alert**  
A change that requires human attention.

Historical information must not be silently overwritten.

---

### 3.4 Monitoring failure is not vendor failure

If Companies House is unavailable, Continuum must never infer:

> Vendor = Critical

or

> Vendor = Healthy

The correct state is:

> **Monitoring unavailable / stale**

System-health and vendor-health states must remain separate.

---

# 4. Target System Architecture

## Frontend

Existing Lovable React application.

Responsibilities:

- Vendor dashboard
- Vendor list
- Vendor profile
- Alerts
- Alert investigation
- Monitoring settings
- User actions
- Organisation settings

Frontend must never contain third-party API secrets.

---

## Backend

Supabase-backed server-side services / Edge Functions.

Responsibilities:

- External provider calls
- Vendor monitoring
- Snapshot creation
- Change detection
- Materiality logic
- Alert creation
- Alert resolution
- Scheduled jobs
- Secure administrative operations

---

## Database

Supabase PostgreSQL.

Responsibilities:

- Organisations
- Users/memberships
- Vendors
- Identifiers
- Trust state
- Monitoring configuration
- Snapshots
- Changes
- Alerts
- Monitoring runs
- Audit records

All schema changes must be tracked as migrations. Once migrations are established, production schema changes should not be made manually through the Supabase dashboard.

---

# 5. Core Domain Model

## 5.1 Organisations

Represents each customer tenant.

Suggested fields:

- `id`
- `name`
- `country`
- `industry`
- `created_at`
- `updated_at`

All customer-owned records must ultimately resolve to an organisation.

---

## 5.2 Organisation Members

Associates authenticated users with organisations.

Suggested fields:

- `id`
- `organisation_id`
- `user_id`
- `role`
- `created_at`

Initial roles:

- Admin
- Procurement
- Vendor Risk
- Compliance
- Finance
- Viewer

Detailed role-based permissions can remain lightweight for MVP.

---

# 6. Vendor Model

## `vendors`

Represents the organisation's relationship with a vendor.

Suggested fields:

- `id`
- `organisation_id`
- `legal_name`
- `display_name`
- `country_code`
- `category`
- `criticality`
- `internal_owner_id`
- `source`
- `source_vendor_id`
- `lifecycle_status`
- `monitoring_status`
- `created_at`
- `updated_at`

### Important

Do not create Companies House-specific fields directly on this table.

For example, avoid:

`companies_house_status`

`gst_status`

`sanctions_result`

Those belong to identifiers, Trust Profile attributes, or external snapshots.

---

# 7. Vendor Identifiers

## `vendor_identifiers`

Allows one vendor to have multiple identifiers.

Suggested fields:

- `id`
- `vendor_id`
- `identifier_type`
- `identifier_value`
- `country_code`
- `is_primary`
- `verification_status`
- `verified_at`
- `created_at`

Examples:

- `COMPANIES_HOUSE_NUMBER`
- `GSTIN`
- `CIN`
- `VAT_NUMBER`
- `LEI`
- `SAP_VENDOR_ID`
- `COUPA_SUPPLIER_ID`

Unique constraints should prevent duplicate identifiers being incorrectly attached to the same organisation/vendor context.

---

# 8. Trust Profile

The Trust Profile represents the **current accepted state** of monitored vendor information.

## `trust_profile_attributes`

Suggested fields:

- `id`
- `vendor_id`
- `attribute_key`
- `current_value` JSONB
- `source`
- `confidence`
- `verified_at`
- `updated_at`
- `updated_from_change_event_id`

Example attributes:

- `company_status`
- `legal_name`
- `registered_address`
- `sic_codes`
- `gst_status`
- `sanctions_status`

Why attribute-based storage:

It avoids adding database columns every time Continuum supports a new monitoring signal.

---

# 9. External Snapshots

## `external_snapshots`

Immutable record of what an external provider returned.

Suggested fields:

- `id`
- `organisation_id`
- `vendor_id`
- `provider`
- `snapshot_type`
- `normalized_data` JSONB
- `raw_data` JSONB
- `fetched_at`
- `provider_reference`
- `fetch_status`
- `created_at`

Snapshots should normally be append-only.

Example:

Companies House returns:

- company status = active
- name = ABC Limited
- address = London
- SIC = 62020

That complete result becomes one snapshot.

---

# 10. Monitoring Runs

## `monitoring_runs`

Tracks each attempt to monitor a vendor.

Suggested fields:

- `id`
- `organisation_id`
- `vendor_id`
- `provider`
- `started_at`
- `completed_at`
- `status`
- `error_type`
- `error_message`
- `snapshot_id`
- `trigger_type`

`trigger_type` examples:

- manual
- scheduled
- retry
- initial_baseline

Possible status values:

- success
- failed
- partial
- skipped

This separates:

> “Vendor has a problem”

from:

> “Our monitoring attempt failed.”

---

# 11. Change Events

## `change_events`

Represents a factual detected difference.

Suggested fields:

- `id`
- `organisation_id`
- `vendor_id`
- `provider`
- `attribute_key`
- `previous_value` JSONB
- `new_value` JSONB
- `severity`
- `materiality_reason`
- `recommended_action`
- `snapshot_id`
- `detected_at`
- `status`

Example:

**Attribute:** company_status

**Old:** active

**New:** liquidation

**Severity:** critical

A change event should be deterministic and traceable back to its evidence.

---

# 12. Alerts

## `alerts`

Represents change events requiring action.

Suggested fields:

- `id`
- `organisation_id`
- `vendor_id`
- `change_event_id`
- `severity`
- `status`
- `assigned_to`
- `title`
- `description`
- `recommended_action`
- `created_at`
- `acknowledged_at`
- `resolved_at`
- `resolution_type`
- `resolution_reason`
- `resolved_by`

Initial lifecycle:

**Open → Investigating → Resolved**

Additional resolution outcomes:

- Verified / Accepted
- False Positive
- Risk Accepted / Exception

Informational changes do not necessarily need alerts.

---

# 13. Audit Events

## `audit_events`

Append-only record of important system and user actions.

Suggested fields:

- `id`
- `organisation_id`
- `vendor_id`
- `actor_type`
- `actor_id`
- `event_type`
- `entity_type`
- `entity_id`
- `metadata` JSONB
- `created_at`

Examples:

- vendor_created
- identifier_added
- monitoring_started
- monitoring_failed
- baseline_created
- change_detected
- alert_created
- alert_assigned
- alert_resolved
- trust_profile_updated

Audit history must not depend on application logs.

---

# 14. Monitoring Configuration

## `vendor_monitoring_config`

Suggested fields:

- `id`
- `vendor_id`
- `provider`
- `enabled`
- `frequency`
- `last_checked_at`
- `next_check_at`
- `created_at`
- `updated_at`

This allows different vendors/providers to run at different frequencies later.

For the MVP, Companies House may use one default schedule.

---

# 15. External Provider Interface

Create a provider abstraction.

Conceptually:

`ExternalVendorDataProvider`

Each provider must support:

- Provider ID
- Supported country
- Required identifier
- Identifier validation
- Fetch
- Normalisation
- Error mapping

Normalized provider response should contain:

- provider
- vendor identifier
- fetched timestamp
- normalized data
- raw data
- provider metadata

Future implementations:

- Companies House
- GST
- MCA
- Sanctions
- IBBI
- Certification providers

The monitoring engine should not need to know how each provider authenticates or structures its response.

---

# 16. Companies House Integration

The first live provider is the official Companies House REST API.

Companies House requires authentication on API requests; for API-key authentication, the key is sent using HTTP Basic authentication as the username with a blank password.

The API key must be stored server-side in:

`COMPANIES_HOUSE_API_KEY`

Never expose it through frontend code.

Companies House also advises keeping API keys outside source code and configuration committed to the repository.

---

# 17. Companies House Attributes — MVP

Fetch and normalise:

- Company number
- Company name
- Company status
- Company type
- Jurisdiction
- Registered office address
- Date of creation
- SIC codes
- Accounts next due date where available
- Confirmation statement next due date where available

Do not attempt to monitor every Companies House endpoint in V1.

---

# 18. Baseline Logic

When Continuum monitors a vendor for the first time:

1. Validate company number.
2. Call Companies House.
3. Store snapshot.
4. Create Trust Profile attributes.
5. Mark baseline established.
6. Do NOT generate alerts.

The first successful external observation establishes the initial comparison point.

---

# 19. Change Detection

On subsequent checks:

1. Fetch new data.
2. Store external snapshot.
3. Compare monitored attributes against current Trust Profile.
4. Create change events only where values differ.
5. Run materiality rules.
6. Create alert where necessary.
7. Do not immediately overwrite the trusted baseline.

This last point matters.

External observation:

> `active → dissolved`

does not automatically mean the user has reviewed the information.

The alert remains open until the change is reviewed/resolved according to workflow.

---

# 20. Duplicate Prevention

The system must prevent:

- Duplicate snapshots caused by retries where appropriate
- Duplicate change events for the same detected state
- Duplicate open alerts for the same unresolved change

Idempotency should be designed into monitoring operations.

If Companies House returns `dissolved` every day for ten days, Continuum should not create ten identical alerts.

---

# 21. Materiality Rules — Initial Version

Use deterministic rules first.

Do not use an LLM to determine severity in MVP.

Example rules:

### Critical

- Active → Dissolved
- Active → Liquidation
- Active → Administration
- Other clearly non-operational company states

### Attention Required

- Company name changed
- Registered office changed
- Material SIC classification change

### Informational

- Non-risk metadata changes

Every rule must produce:

- Severity
- Explanation
- Recommended action

Example:

> **Severity:** Critical  
> **Reason:** Company status changed from Active to Liquidation.  
> **Recommended Action:** Review the vendor relationship and any pending financial or operational commitments immediately.

---

# 22. Alert Resolution

When user selects **Verified / Accepted**:

1. Record resolution.
2. Update Trust Profile with verified new value.
3. Preserve old value in history/change event.
4. Close alert.
5. Write audit event.

When user selects **False Positive**:

1. Record reason.
2. Close/dismiss alert.
3. Do not update trusted baseline.

When user selects **Risk Accepted / Exception**:

1. Record reason.
2. Record owner.
3. Optional expiry date.
4. Preserve underlying detected change.

---

# 23. Vendor Health

Vendor health must be derived from unresolved actionable conditions.

Suggested MVP rules:

### Healthy

No open critical or attention alerts and monitoring is current.

### Attention Required

At least one unresolved attention alert.

### Critical

At least one unresolved critical alert.

### Monitoring Issue

Monitoring is stale or provider checks have repeatedly failed.

Do not merge Monitoring Issue into Healthy/Attention/Critical without explicitly displaying the distinction.

---

# 24. Scheduled Monitoring

After manual monitoring works reliably, introduce scheduled checks.

Supabase supports recurring jobs through Cron/`pg_cron`; scheduled Edge Functions can also be invoked using `pg_cron` with `pg_net`.

Requirements:

- Batch vendors
- Respect rate limits
- Do not run overlapping jobs
- Retry transient failures
- Do not retry permanent failures endlessly
- Continue processing other vendors when one fails
- Record every run
- Support manual trigger for debugging

Companies House currently documents a default limit of **600 requests per five-minute period**, returning HTTP 429 when exceeded.

The scheduler must therefore support throttling and backoff.

---

# 25. Error Handling

The Companies House provider must distinguish:

### Validation errors

Example:
- Invalid company number

### Authentication errors

- 401 / invalid API key

### Missing data

- 404 / company not found

### Rate limiting

- 429

### Provider/server errors

- 5xx

### Network errors

- timeout
- connection failure

### Parsing errors

- unexpected provider response

Errors must be normalised into internal error types.

---

# 26. Retry Strategy

Retry:

- Timeout
- Temporary network failure
- Certain 5xx failures
- 429 after appropriate delay

Do not repeatedly retry:

- Invalid company number
- 404 company not found
- Authentication failure until credentials change

Retries must not create duplicate snapshots, changes, or alerts.

---

# 27. Security

Continuum is multi-tenant.

Every customer-owned record must be protected by organisation boundaries.

Supabase states that Row Level Security should be enabled for tables in exposed schemas.

Requirements:

- Enable RLS
- Users only access organisations they belong to
- Users cannot access another customer's vendors
- External provider API keys remain server-side
- Service-role credentials never reach the browser
- Sensitive actions are audit logged
- Raw provider responses are not unnecessarily exposed to frontend clients

Tenant isolation must have automated tests.

---

# 28. Database Migration Rules

All database changes must:

1. Be created as Supabase migrations.
2. Be committed to Git.
3. Be locally testable.
4. Avoid destructive changes unless explicitly reviewed.
5. Include appropriate indexes and foreign keys.
6. Include RLS changes where needed.

Once migration-driven development begins, do not casually modify production tables from the dashboard because this can cause local/remote migration history to diverge.

---

# 29. Observability

The MVP should allow developers to answer:

- Did monitoring run?
- Which vendor was checked?
- Which provider was called?
- Did the call succeed?
- How long did it take?
- Was a snapshot stored?
- Was a change detected?
- Was an alert created?
- Why did something fail?

Use structured application logging and database monitoring records.

Do not put API keys, tokens, or sensitive raw data into logs.

---

# 30. Testing Requirements

## Unit tests

Required for:

- Identifier validation
- Companies House normalisation
- Change comparison
- Materiality rules
- Duplicate detection
- Error mapping

## Integration tests

Required for:

- Vendor → snapshot
- First snapshot → baseline
- Second snapshot → no change
- Active → dissolved
- Address change
- Alert creation
- Alert resolution
- Trust Profile update

## Security tests

Required for:

- Organisation A cannot access Organisation B
- Unauthenticated user cannot access private vendor information
- Client cannot access server secrets

## Failure tests

Required for:

- Companies House timeout
- 401
- 404
- 429
- 500
- malformed response

---

# 31. Required End-to-End Demo

The backend MVP is not complete until this works:

### Scenario

ABC Limited exists in Continuum.

Companies House number:

`XXXXXXXX`

### Initial check

Companies House:

> Status: Active

Continuum:

> Baseline established.

No alert generated.

### Later check

Companies House:

> Status: Liquidation

Continuum:

- Stores new snapshot
- Detects Active → Liquidation
- Creates change event
- Classifies Critical
- Creates alert
- Vendor dashboard becomes Critical
- User opens supporting evidence

### Resolution

User verifies change.

Continuum:

- Resolves alert
- Updates Trust Profile
- Preserves Active → Liquidation history
- Records user, time, reason and evidence
- Continues monitoring from the updated state

If this workflow works reliably, Continuum's core monitoring engine exists.

---

# 32. Explicitly Out of Scope

Do not build yet:

- Vendor discovery
- Full vendor onboarding
- Payments
- Invoice processing
- Contract lifecycle management
- Full custom risk scoring
- AI-based materiality classification
- Automated vendor suspension
- Large integration marketplace
- Advanced analytics
- Supplier performance
- Offboarding
- Automatic financial decision-making

---

# 33. Engineering Success Criteria

The first backend milestone is successful when:

- A vendor can have an external identifier.
- Companies House can be queried securely.
- Results are normalised.
- Historical snapshots are stored.
- An initial baseline can be established.
- Changes are detected deterministically.
- Material changes create one correct alert.
- Duplicate alerts are prevented.
- Failed checks do not alter vendor trust incorrectly.
- User resolution updates the Trust Profile.
- History remains intact.
- Organisation data is isolated.
- Automated tests cover the critical workflow.

---

# 34. Core Engineering Principle

**Continuum must never simply tell users that something changed; it must preserve what was known before, show what is known now, prove where the new information came from, and record what the organisation decided to do about it.**