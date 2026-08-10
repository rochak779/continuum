-- Fix RLS infinite recursion and standardise organisation-membership checks.
--
-- Every policy added in 20260810130000 scoped access with an inline
-- subquery against organisation_members:
--
--   organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
--
-- For organisation_members' own SELECT policy this is self-referential:
-- evaluating the policy requires re-evaluating the same policy on the same
-- table, which Postgres correctly rejects as infinite recursion
-- ("infinite recursion detected in policy for relation
-- organisation_members") -- caught by scripts/verify-tenant-isolation.sh.
--
-- Fix: a single SECURITY DEFINER helper function that looks up the caller's
-- organisation memberships once, bypassing RLS internally (it runs as the
-- function owner, not the caller), so nothing that calls it re-triggers
-- organisation_members' own policy. Every policy now calls this function
-- instead of repeating the inline subquery -- one definition of "which
-- organisations can this user see" for all eleven tenant tables.

CREATE OR REPLACE FUNCTION public.current_user_organisation_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organisation_id FROM public.organisation_members WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_organisation_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_organisation_ids() TO authenticated;

-- organisations ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation" ON public.organisations;
CREATE POLICY "Members can view their organisation" ON public.organisations
  FOR SELECT TO authenticated USING (
    id IN (SELECT public.current_user_organisation_ids())
  );

-- organisation_members ---------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's membership" ON public.organisation_members;
CREATE POLICY "Members can view their organisation's membership" ON public.organisation_members
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- vendors ------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's vendors" ON public.vendors;
CREATE POLICY "Members can view their organisation's vendors" ON public.vendors
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can create vendors in their organisation" ON public.vendors;
CREATE POLICY "Members can create vendors in their organisation" ON public.vendors
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can update their organisation's vendors" ON public.vendors;
CREATE POLICY "Members can update their organisation's vendors" ON public.vendors
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.current_user_organisation_ids()))
  WITH CHECK (organisation_id IN (SELECT public.current_user_organisation_ids()));

-- vendor_identifiers ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's vendor identifiers" ON public.vendor_identifiers;
CREATE POLICY "Members can view their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can create vendor identifiers in their organisation" ON public.vendor_identifiers;
CREATE POLICY "Members can create vendor identifiers in their organisation" ON public.vendor_identifiers
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can update their organisation's vendor identifiers" ON public.vendor_identifiers;
CREATE POLICY "Members can update their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.current_user_organisation_ids()))
  WITH CHECK (organisation_id IN (SELECT public.current_user_organisation_ids()));

DROP POLICY IF EXISTS "Members can delete their organisation's vendor identifiers" ON public.vendor_identifiers;
CREATE POLICY "Members can delete their organisation's vendor identifiers" ON public.vendor_identifiers
  FOR DELETE TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- external_snapshots ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's external snapshots" ON public.external_snapshots;
CREATE POLICY "Members can view their organisation's external snapshots" ON public.external_snapshots
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- monitoring_runs ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's monitoring runs" ON public.monitoring_runs;
CREATE POLICY "Members can view their organisation's monitoring runs" ON public.monitoring_runs
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- change_events ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's change events" ON public.change_events;
CREATE POLICY "Members can view their organisation's change events" ON public.change_events
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can update status on their organisation's change events" ON public.change_events;
CREATE POLICY "Members can update status on their organisation's change events" ON public.change_events
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.current_user_organisation_ids()))
  WITH CHECK (organisation_id IN (SELECT public.current_user_organisation_ids()));

-- trust_profile_attributes ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's trust profile" ON public.trust_profile_attributes;
CREATE POLICY "Members can view their organisation's trust profile" ON public.trust_profile_attributes
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- alerts ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's alerts" ON public.alerts;
CREATE POLICY "Members can view their organisation's alerts" ON public.alerts
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can update their organisation's alerts" ON public.alerts;
CREATE POLICY "Members can update their organisation's alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.current_user_organisation_ids()))
  WITH CHECK (organisation_id IN (SELECT public.current_user_organisation_ids()));

-- audit_events ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's audit events" ON public.audit_events;
CREATE POLICY "Members can view their organisation's audit events" ON public.audit_events
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

-- vendor_monitoring_config ---------------------------------------------------------
DROP POLICY IF EXISTS "Members can view their organisation's monitoring config" ON public.vendor_monitoring_config;
CREATE POLICY "Members can view their organisation's monitoring config" ON public.vendor_monitoring_config
  FOR SELECT TO authenticated USING (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can create monitoring config in their organisation" ON public.vendor_monitoring_config;
CREATE POLICY "Members can create monitoring config in their organisation" ON public.vendor_monitoring_config
  FOR INSERT TO authenticated WITH CHECK (
    organisation_id IN (SELECT public.current_user_organisation_ids())
  );

DROP POLICY IF EXISTS "Members can update their organisation's monitoring config" ON public.vendor_monitoring_config;
CREATE POLICY "Members can update their organisation's monitoring config" ON public.vendor_monitoring_config
  FOR UPDATE TO authenticated
  USING (organisation_id IN (SELECT public.current_user_organisation_ids()))
  WITH CHECK (organisation_id IN (SELECT public.current_user_organisation_ids()));
