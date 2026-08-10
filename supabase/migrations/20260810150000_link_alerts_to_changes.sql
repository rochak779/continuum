-- Alerts are actionable wrappers around factual change events. Evidence is
-- linked both directly and through the event so every alert is auditable.
ALTER TABLE public.vendor_monitoring_alerts
  ADD COLUMN change_event_id uuid REFERENCES public.vendor_change_events(id) ON DELETE RESTRICT,
  ADD COLUMN snapshot_id uuid REFERENCES public.vendor_company_snapshots(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX vendor_monitoring_alerts_change_event_idx
  ON public.vendor_monitoring_alerts(change_event_id)
  WHERE change_event_id IS NOT NULL;

CREATE INDEX vendor_monitoring_alerts_snapshot_idx
  ON public.vendor_monitoring_alerts(snapshot_id);
