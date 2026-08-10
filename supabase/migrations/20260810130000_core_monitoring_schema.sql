-- Core continuous vendor monitoring schema.
--
-- Implements the design in docs/database-design.md (derived from ERD.md),
-- replacing the single-tenant, Companies-House-specific schema introduced in
-- 20260810111100 and 20260810120000 with:
--
--   * a real multi-tenant organisation model (organisations,
--     organisation_members) that every other table resolves to
--   * a provider-agnostic monitoring pipeline (vendor_identifiers,
--     trust_profile_attributes, external_snapshots, monitoring_runs,
--     change_events, alerts, audit_events, vendor_monitoring_config)
--     instead of Companies-House-shaped tables
--
-- This is a from-scratch rebuild of `vendors` and a drop of the
-- Companies-House-specific monitoring tables: there is no production data to
-- migrate forward, and the old shape (owner_id-scoped, dedicated
-- companies_house_* columns) is structurally incompatible with the
-- organisation-scoped, provider-agnostic design this migration establishes.
-- `profiles` and `team_invites` are untouched — outside this design's scope.

-- ============================================================================
-- 0. Drop legacy Companies-House-specific tables (superseded below)
-- ============================================================================

DROP TABLE IF EXISTS public.vendor_monitoring_failures CASCADE;
DROP TABLE IF EXISTS public.vendor_monitoring_alerts CASCADE;
DROP TABLE IF EXISTS public.vendor_company_snapshots CASCADE;
DROP TABLE IF EXISTS public.vendors CASCADE;

-- ============================================================================
-- 1. Tenancy: organisations, organisation_members
-- ============================================================================

CREATE TABLE public.organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  industry text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER update_organisations_updated_at
  BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.organisations TO authenticated;
GRANT ALL ON public.organisations TO service_role;

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

-- organisation_members references organisations, and organisations' RLS
-- policy (below) references organisation_members — both tables must exist
-- before either policy can be created, so table creation for both comes
-- first and policies for both follow after.

CREATE TABLE public.organisation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'procurement', 'vendor_risk', 'compliance', 'finance', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE INDEX organisation_members_user_id_idx ON public.organisation_members(user_id);

GRANT SELECT ON public.organisation_members TO authenticated;
GRANT ALL ON public.organisation_members TO service_role;

ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

-- Membership rows are managed server-side (invites/signup flow); members may
-- only read the membership list of organisations they themselves belong to.
CREATE POLICY "Members can view their organisation's membership" ON public.organisation_members
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can view their organisation" ON public.organisations
  FOR SELECT TO authenticated USING (
    id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 2. vendors
-- ============================================================================

CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  display_name text,
  country_code text,
  category text,
  criticality text CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
  internal_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'sap', 'coupa')),
  source_vendor_id text,
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('draft', 'active', 'inactive', 'archived')),
  monitoring_status text NOT NULL DEFAULT 'not_monitored' CHECK (monitoring_status IN ('not_monitored', 'baseline_pending', 'monitoring', 'stale', 'failing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- No Companies-House-specific columns here by design — that data lives in
-- vendor_identifiers (§3 below) and trust_profile_attributes/external_snapshots.

CREATE UNIQUE INDEX vendors_org_source_vendor_id_idx
  ON public.vendors(organisation_id, source, source_vendor_id)
  WHERE source_vendor_id IS NOT NULL;

CREATE INDEX vendors_organisation_id_idx ON public.vendors(organisation_id);
CREATE INDEX vendors_org_lifecycle_status_idx ON public.vendors(organisation_id, lifecycle_status);
CREATE INDEX vendors_org_monitoring_status_idx ON public.vendors(organisation_id, monitoring_status);

CREATE TRIGGER update_vendors_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's vendors" ON public.vendors
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can create vendors in their organisation" ON public.vendors
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can update their organisation's vendors" ON public.vendors
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()));

-- ============================================================================
-- Shared trigger: denormalise organisation_id from vendors on every child row
-- ============================================================================
--
-- Every table below carries organisation_id denormalised from vendor_id
-- (design doc §0.1 / §11 invariant). This trigger is the enforcement point:
-- it always derives organisation_id from the referenced vendor rather than
-- trusting the caller, so a client can never write a child row into an
-- organisation it doesn't own via a mismatched organisation_id.

CREATE OR REPLACE FUNCTION public.set_organisation_id_from_vendor()
RETURNS TRIGGER AS $$
BEGIN
  NEW.organisation_id := (SELECT organisation_id FROM public.vendors WHERE id = NEW.vendor_id);
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'vendor % does not exist', NEW.vendor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.set_organisation_id_from_vendor() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. vendor_identifiers
-- ============================================================================

CREATE TABLE public.vendor_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  country_code text,
  is_primary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'invalid')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, identifier_type, identifier_value)
);

CREATE UNIQUE INDEX vendor_identifiers_primary_per_type_idx
  ON public.vendor_identifiers(vendor_id, identifier_type)
  WHERE is_primary;

CREATE INDEX vendor_identifiers_vendor_id_idx ON public.vendor_identifiers(vendor_id);

CREATE TRIGGER set_vendor_identifiers_organisation_id
  BEFORE INSERT ON public.vendor_identifiers
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_identifiers TO authenticated;
GRANT ALL ON public.vendor_identifiers TO service_role;

ALTER TABLE public.vendor_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can create vendor identifiers in their organisation" ON public.vendor_identifiers
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can update their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()));
CREATE POLICY "Members can delete their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR DELETE TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 4. external_snapshots (append-only)
-- ============================================================================

CREATE TABLE public.external_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  snapshot_type text NOT NULL DEFAULT 'profile',
  normalized_data jsonb NOT NULL,
  raw_data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  provider_reference text,
  fetch_status text NOT NULL DEFAULT 'success' CHECK (fetch_status IN ('success', 'partial')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX external_snapshots_vendor_provider_fetched_idx
  ON public.external_snapshots(vendor_id, provider, fetched_at DESC);
CREATE INDEX external_snapshots_organisation_id_idx ON public.external_snapshots(organisation_id);

CREATE TRIGGER set_external_snapshots_organisation_id
  BEFORE INSERT ON public.external_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

-- Append-only: authenticated members may read, only service_role writes.
GRANT SELECT ON public.external_snapshots TO authenticated;
GRANT ALL ON public.external_snapshots TO service_role;

ALTER TABLE public.external_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's external snapshots" ON public.external_snapshots
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 5. monitoring_runs
-- ============================================================================

CREATE TABLE public.monitoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial', 'skipped')),
  error_type text,
  error_message text,
  snapshot_id uuid REFERENCES public.external_snapshots(id) ON DELETE SET NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'retry', 'initial_baseline')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforces "do not run overlapping jobs" (ERD §24) at the database level.
CREATE UNIQUE INDEX monitoring_runs_one_running_per_vendor_provider_idx
  ON public.monitoring_runs(vendor_id, provider)
  WHERE status = 'running';

CREATE INDEX monitoring_runs_vendor_started_idx ON public.monitoring_runs(vendor_id, started_at DESC);
CREATE INDEX monitoring_runs_org_status_idx ON public.monitoring_runs(organisation_id, status);

CREATE TRIGGER set_monitoring_runs_organisation_id
  BEFORE INSERT ON public.monitoring_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

GRANT SELECT ON public.monitoring_runs TO authenticated;
GRANT ALL ON public.monitoring_runs TO service_role;

ALTER TABLE public.monitoring_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's monitoring runs" ON public.monitoring_runs
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 6. change_events
-- ============================================================================

CREATE TABLE public.change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  attribute_key text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  severity text NOT NULL CHECK (severity IN ('critical', 'attention', 'info')),
  materiality_reason text NOT NULL,
  recommended_action text NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES public.external_snapshots(id) ON DELETE RESTRICT,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  dedupe_key text NOT NULL,
  UNIQUE (dedupe_key)
);

CREATE INDEX change_events_vendor_detected_idx ON public.change_events(vendor_id, detected_at DESC);
CREATE INDEX change_events_organisation_id_idx ON public.change_events(organisation_id);
CREATE INDEX change_events_snapshot_id_idx ON public.change_events(snapshot_id);

CREATE TRIGGER set_change_events_organisation_id
  BEFORE INSERT ON public.change_events
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

-- Detection fields are write-once; only `status` is expected to change
-- (flipped to 'resolved' by the same transaction that resolves the linked
-- alert), so authenticated members get SELECT + UPDATE, no INSERT/DELETE.
GRANT SELECT, UPDATE ON public.change_events TO authenticated;
GRANT ALL ON public.change_events TO service_role;

ALTER TABLE public.change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's change events" ON public.change_events
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can update status on their organisation's change events" ON public.change_events
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 7. trust_profile_attributes
-- ============================================================================

CREATE TABLE public.trust_profile_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  attribute_key text NOT NULL,
  current_value jsonb NOT NULL,
  source text NOT NULL,
  confidence text NOT NULL DEFAULT 'verified' CHECK (confidence IN ('verified', 'provider_reported', 'unverified')),
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_from_change_event_id uuid REFERENCES public.change_events(id) ON DELETE SET NULL,
  UNIQUE (vendor_id, attribute_key)
);

CREATE INDEX trust_profile_attributes_vendor_id_idx ON public.trust_profile_attributes(vendor_id);
CREATE INDEX trust_profile_attributes_organisation_id_idx ON public.trust_profile_attributes(organisation_id);

CREATE TRIGGER set_trust_profile_attributes_organisation_id
  BEFORE INSERT ON public.trust_profile_attributes
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

CREATE TRIGGER update_trust_profile_attributes_updated_at
  BEFORE UPDATE ON public.trust_profile_attributes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- This table is only ever written by the resolution workflow / baseline
-- creation (both server-side, service_role) — members get read-only access,
-- consistent with §12: it isn't in the design doc's list of end-user-writable
-- tables even though its values are user-driven (via alert resolution).
GRANT SELECT ON public.trust_profile_attributes TO authenticated;
GRANT ALL ON public.trust_profile_attributes TO service_role;

ALTER TABLE public.trust_profile_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's trust profile" ON public.trust_profile_attributes
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 8. alerts
-- ============================================================================

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  change_event_id uuid NOT NULL REFERENCES public.change_events(id) ON DELETE RESTRICT,
  severity text NOT NULL CHECK (severity IN ('critical', 'attention', 'info')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL,
  recommended_action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_type text CHECK (resolution_type IN ('verified_accepted', 'false_positive', 'risk_accepted')),
  resolution_reason text,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_expiry timestamptz,
  UNIQUE (change_event_id)
);

CREATE INDEX alerts_org_status_idx ON public.alerts(organisation_id, status);
CREATE INDEX alerts_vendor_status_idx ON public.alerts(vendor_id, status);
CREATE INDEX alerts_assigned_to_idx ON public.alerts(assigned_to);

CREATE TRIGGER set_alerts_organisation_id
  BEFORE INSERT ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

-- Alert creation is part of the monitoring engine (service_role only);
-- members may update lifecycle fields (status/assigned_to/resolution_*) but
-- not insert new alerts directly.
GRANT SELECT, UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's alerts" ON public.alerts
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can update their organisation's alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 9. audit_events (strictly append-only)
-- ============================================================================

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'service')),
  actor_id uuid,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_org_created_idx ON public.audit_events(organisation_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON public.audit_events(entity_type, entity_id);
CREATE INDEX audit_events_vendor_created_idx ON public.audit_events(vendor_id, created_at DESC) WHERE vendor_id IS NOT NULL;

-- No organisation_id-from-vendor trigger here: vendor_id is nullable
-- (organisation-level events have no vendor), so organisation_id must be
-- supplied directly by the writer (always service_role) rather than derived.

-- Strictly append-only: no UPDATE grant to any role, including service_role.
GRANT SELECT ON public.audit_events TO authenticated;
GRANT SELECT, INSERT ON public.audit_events TO service_role;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );

-- ============================================================================
-- 10. vendor_monitoring_config
-- ============================================================================

CREATE TABLE public.vendor_monitoring_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  frequency interval NOT NULL DEFAULT '24:00:00',
  last_checked_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, provider)
);

-- Scheduler poll query: "which vendor/provider pairs are due", across the
-- whole table — deliberately not organisation-scoped.
CREATE INDEX vendor_monitoring_config_due_idx ON public.vendor_monitoring_config(enabled, next_check_at);
CREATE INDEX vendor_monitoring_config_organisation_id_idx ON public.vendor_monitoring_config(organisation_id);

CREATE TRIGGER set_vendor_monitoring_config_organisation_id
  BEFORE INSERT ON public.vendor_monitoring_config
  FOR EACH ROW EXECUTE FUNCTION public.set_organisation_id_from_vendor();

CREATE TRIGGER update_vendor_monitoring_config_updated_at
  BEFORE UPDATE ON public.vendor_monitoring_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE ON public.vendor_monitoring_config TO authenticated;
GRANT ALL ON public.vendor_monitoring_config TO service_role;

ALTER TABLE public.vendor_monitoring_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their organisation's monitoring config" ON public.vendor_monitoring_config
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can create monitoring config in their organisation" ON public.vendor_monitoring_config
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid())
  );
CREATE POLICY "Members can update their organisation's monitoring config" ON public.vendor_monitoring_config
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()))
  WITH CHECK (organisation_id IN (SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid()));
