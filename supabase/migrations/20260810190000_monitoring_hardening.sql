-- Enforce evidence linkage for every new alert while retaining any legacy rows
-- that predate change events. NOT VALID constraints still apply to new writes.
ALTER TABLE public.vendor_monitoring_alerts
  ADD CONSTRAINT vendor_monitoring_alerts_change_event_required
    CHECK (change_event_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT vendor_monitoring_alerts_snapshot_required
    CHECK (snapshot_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT vendor_monitoring_alerts_severity_valid
    CHECK (severity IN ('critical', 'attention', 'info')) NOT VALID,
  ADD CONSTRAINT vendor_monitoring_alerts_status_valid
    CHECK (status IN ('open', 'acknowledged', 'resolved')) NOT VALID;

-- Dashboard health and recent-change queries should avoid scanning complete
-- alert/event histories as those append-only tables grow.
CREATE INDEX vendor_monitoring_alerts_unresolved_idx
  ON public.vendor_monitoring_alerts(vendor_id, severity, detected_at DESC)
  WHERE status <> 'resolved';
CREATE INDEX vendor_change_events_material_recent_idx
  ON public.vendor_change_events(detected_at DESC)
  WHERE severity IN ('critical', 'attention');
CREATE INDEX vendor_monitoring_runs_stale_idx
  ON public.vendor_monitoring_runs(started_at)
  WHERE status = 'running';

-- The lease table contains internal coordination tokens only. Service-role
-- access bypasses RLS; browser roles receive no policy and therefore no rows.
ALTER TABLE public.monitoring_scheduler_leases ENABLE ROW LEVEL SECURITY;

-- Permit the active worker to renew its own lease between vendors. A different
-- token can still acquire only after expiry.
CREATE OR REPLACE FUNCTION public.acquire_companies_house_scheduler_lease(
  p_lease_token text,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acquired boolean;
BEGIN
  INSERT INTO monitoring_scheduler_leases (scheduler, lease_token, expires_at)
  VALUES ('companies_house', p_lease_token, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (scheduler) DO UPDATE
    SET lease_token = EXCLUDED.lease_token, expires_at = EXCLUDED.expires_at
    WHERE monitoring_scheduler_leases.expires_at <= now()
       OR monitoring_scheduler_leases.lease_token = p_lease_token;
  SELECT monitoring_scheduler_leases.lease_token = p_lease_token
    INTO acquired FROM monitoring_scheduler_leases WHERE scheduler = 'companies_house';
  RETURN coalesce(acquired, false);
END;
$$;
REVOKE ALL ON FUNCTION public.acquire_companies_house_scheduler_lease(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_companies_house_scheduler_lease(text, integer) TO service_role;

-- Trigger helpers are not application APIs.
REVOKE ALL ON FUNCTION public.sync_companies_house_monitoring_config() FROM PUBLIC;
