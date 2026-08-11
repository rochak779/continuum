-- New vendors now get an immediate baseline check on creation (see
-- runInitialBaselineChecksFn), so the scheduled sweep no longer needs to
-- poll every 5 minutes looking for newly-queued vendors. Re-point it at a
-- single daily run early in the morning (06:00 UTC) that re-checks every
-- vendor whose monitoring is due (next_check_at <= now, which — given the
-- 24h cadence set in markChecked — is normally "everyone, once a day").
--
-- cron.schedule() upserts by job name, so this just updates the existing
-- 'companies-house-monitoring' job in place.
SELECT cron.schedule(
  'companies-house-monitoring',
  '0 6 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'monitoring_app_url') || '/api/monitoring/companies-house',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-monitoring-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'monitoring_scheduler_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
