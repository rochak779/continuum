-- Pipeline health is stored separately from business-facing vendor health.
-- Vendor health is computed from this status plus unresolved alerts.
ALTER TABLE public.vendors
  ADD COLUMN monitoring_status text NOT NULL DEFAULT 'not_monitored'
  CHECK (monitoring_status IN (
    'not_monitored',
    'baseline_pending',
    'monitoring',
    'stale',
    'failing'
  ));

CREATE INDEX vendors_monitoring_status_idx
  ON public.vendors(owner_id, monitoring_status);
