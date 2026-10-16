CREATE TABLE continuum.vendor_monitoring_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES continuum.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, provider)
);

CREATE INDEX vendor_monitoring_config_due_idx
  ON continuum.vendor_monitoring_config(enabled, next_check_at);
GRANT SELECT ON continuum.vendor_monitoring_config TO authenticated;
GRANT ALL ON continuum.vendor_monitoring_config TO service_role;
ALTER TABLE continuum.vendor_monitoring_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view vendor monitoring config"
  ON continuum.vendor_monitoring_config FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM continuum.vendors v WHERE v.id = vendor_id AND v.owner_id = auth.uid()));
CREATE TRIGGER update_vendor_monitoring_config_updated_at
  BEFORE UPDATE ON continuum.vendor_monitoring_config
  FOR EACH ROW EXECUTE FUNCTION continuum.update_updated_at_column();

CREATE TABLE continuum.vendor_monitoring_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES continuum.vendors(id) ON DELETE CASCADE,
  provider text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'partial', 'skipped')),
  error_type text,
  error_message text,
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('manual', 'scheduled', 'retry', 'initial_baseline')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendor_monitoring_runs_active_idx
  ON continuum.vendor_monitoring_runs(vendor_id, provider) WHERE status = 'running';
CREATE INDEX vendor_monitoring_runs_vendor_idx
  ON continuum.vendor_monitoring_runs(vendor_id, started_at DESC);
GRANT SELECT ON continuum.vendor_monitoring_runs TO authenticated;
GRANT ALL ON continuum.vendor_monitoring_runs TO service_role;
ALTER TABLE continuum.vendor_monitoring_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view vendor monitoring runs"
  ON continuum.vendor_monitoring_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM continuum.vendors v WHERE v.id = vendor_id AND v.owner_id = auth.uid()));

CREATE TABLE continuum.monitoring_scheduler_leases (
  scheduler text PRIMARY KEY,
  lease_token text NOT NULL,
  expires_at timestamptz NOT NULL
);
GRANT ALL ON continuum.monitoring_scheduler_leases TO service_role;

CREATE OR REPLACE FUNCTION continuum.acquire_companies_house_scheduler_lease(
  p_lease_token text,
  p_lease_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = continuum, extensions, pg_temp AS $$
DECLARE acquired boolean;
BEGIN
  INSERT INTO monitoring_scheduler_leases (scheduler, lease_token, expires_at)
  VALUES ('companies_house', p_lease_token, now() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (scheduler) DO UPDATE
    SET lease_token = EXCLUDED.lease_token, expires_at = EXCLUDED.expires_at
    WHERE monitoring_scheduler_leases.expires_at <= now();
  SELECT monitoring_scheduler_leases.lease_token = p_lease_token
    INTO acquired FROM monitoring_scheduler_leases WHERE scheduler = 'companies_house';
  RETURN coalesce(acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION continuum.release_companies_house_scheduler_lease(p_lease_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = continuum, extensions, pg_temp AS $$
  DELETE FROM monitoring_scheduler_leases
  WHERE scheduler = 'companies_house'
    AND monitoring_scheduler_leases.lease_token = p_lease_token;
$$;
REVOKE ALL ON FUNCTION continuum.acquire_companies_house_scheduler_lease(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION continuum.release_companies_house_scheduler_lease(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION continuum.acquire_companies_house_scheduler_lease(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION continuum.release_companies_house_scheduler_lease(text) TO service_role;

INSERT INTO continuum.vendor_monitoring_config (vendor_id, provider)
SELECT id, 'companies_house' FROM continuum.vendors WHERE companies_house_number IS NOT NULL
ON CONFLICT (vendor_id, provider) DO NOTHING;

CREATE OR REPLACE FUNCTION continuum.sync_companies_house_monitoring_config()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = continuum, extensions, pg_temp AS $$
BEGIN
  IF NEW.companies_house_number IS NOT NULL THEN
    INSERT INTO vendor_monitoring_config (vendor_id, provider, enabled, next_check_at)
    VALUES (NEW.id, 'companies_house', true, now())
    ON CONFLICT (vendor_id, provider) DO UPDATE SET enabled = true;
  ELSIF OLD.companies_house_number IS NOT NULL THEN
    UPDATE vendor_monitoring_config SET enabled = false
    WHERE vendor_id = NEW.id AND provider = 'companies_house';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_companies_house_monitoring_config
  AFTER INSERT OR UPDATE OF companies_house_number ON continuum.vendors
  FOR EACH ROW EXECUTE FUNCTION continuum.sync_companies_house_monitoring_config();

-- Supabase Cron invokes the authenticated application endpoint every five
-- minutes. Before applying this migration, create Vault secrets named
-- `continuum_monitoring_app_url` and `continuum_monitoring_scheduler_secret`.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule(
  'continuum-companies-house-monitoring',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'continuum_monitoring_app_url') || '/api/monitoring/companies-house',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-monitoring-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'continuum_monitoring_scheduler_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
