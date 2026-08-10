-- Companies House monitoring: vendor company number, historical snapshots,
-- monitoring alerts, and monitoring failures.
--
-- Design notes:
--  * Snapshots are append-only. We never overwrite prior company information;
--    history is preserved for audit.
--  * Alerts capture the previous/new value of a single changed attribute plus
--    severity and status. A unique dedupe_key prevents duplicate alerts for the
--    same detected change.
--  * Failures record monitoring errors separately so a failed API check never
--    mutates vendor data or looks like a real company change.
--  * These tables are written by the service-role client (bypasses RLS) and
--    read by owners through RLS scoped via vendors.owner_id.

-- 1. Vendor company number -------------------------------------------------
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS companies_house_number text;

-- 2. Historical company snapshots (append-only) ----------------------------
CREATE TABLE public.vendor_company_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'companies_house',
  company_number text NOT NULL,
  company_name text,
  company_status text,
  company_type text,
  registered_office_address jsonb,
  date_of_creation date,
  jurisdiction text,
  accounts_next_due date,
  accounts_status text,
  confirmation_statement_next_due date,
  sic_codes text[],
  raw_response jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_company_snapshots_vendor_idx
  ON public.vendor_company_snapshots(vendor_id, checked_at DESC);

GRANT SELECT ON public.vendor_company_snapshots TO authenticated;
GRANT ALL ON public.vendor_company_snapshots TO service_role;

ALTER TABLE public.vendor_company_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their vendor snapshots"
  ON public.vendor_company_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));

-- 3. Monitoring alerts -----------------------------------------------------
CREATE TABLE public.vendor_monitoring_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'companies_house',
  attribute_checked text NOT NULL,
  previous_value text,
  new_value text,
  severity text NOT NULL,               -- 'critical' | 'attention' | 'info'
  status text NOT NULL DEFAULT 'open',  -- 'open' | 'acknowledged' | 'resolved'
  checked_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforces "do not create duplicate alerts for the same detected change".
CREATE UNIQUE INDEX vendor_monitoring_alerts_dedupe_idx
  ON public.vendor_monitoring_alerts(dedupe_key);

CREATE INDEX vendor_monitoring_alerts_vendor_idx
  ON public.vendor_monitoring_alerts(vendor_id, detected_at DESC);

GRANT SELECT, UPDATE ON public.vendor_monitoring_alerts TO authenticated;
GRANT ALL ON public.vendor_monitoring_alerts TO service_role;

ALTER TABLE public.vendor_monitoring_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their vendor alerts"
  ON public.vendor_monitoring_alerts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));

-- Owners can update alert status (acknowledge / resolve) but not other fields'
-- provenance; column-level enforcement is left to the app for now.
CREATE POLICY "Owners can update their vendor alert status"
  ON public.vendor_monitoring_alerts FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));

-- 4. Monitoring failures ---------------------------------------------------
CREATE TABLE public.vendor_monitoring_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  company_number text,
  source text NOT NULL DEFAULT 'companies_house',
  error_type text NOT NULL,
  message text,
  http_status int,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX vendor_monitoring_failures_vendor_idx
  ON public.vendor_monitoring_failures(vendor_id, checked_at DESC);

GRANT SELECT ON public.vendor_monitoring_failures TO authenticated;
GRANT ALL ON public.vendor_monitoring_failures TO service_role;

ALTER TABLE public.vendor_monitoring_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their vendor monitoring failures"
  ON public.vendor_monitoring_failures FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));
