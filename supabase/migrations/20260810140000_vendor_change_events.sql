-- Factual differences between trusted vendor data and external observations.
CREATE TABLE public.vendor_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.vendor_company_snapshots(id) ON DELETE RESTRICT,
  source text NOT NULL,
  attribute_key text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  severity text NOT NULL CHECK (severity IN ('critical', 'attention', 'info')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  dedupe_key text NOT NULL UNIQUE
);

CREATE INDEX vendor_change_events_vendor_idx
  ON public.vendor_change_events(vendor_id, detected_at DESC);
CREATE INDEX vendor_change_events_snapshot_idx
  ON public.vendor_change_events(snapshot_id);

GRANT SELECT ON public.vendor_change_events TO authenticated;
GRANT ALL ON public.vendor_change_events TO service_role;

ALTER TABLE public.vendor_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their vendor change events"
  ON public.vendor_change_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));

-- Chunk 8 used the provider field name. Keep existing baselines compatible
-- with the canonical Trust Profile attribute name used by change detection.
UPDATE public.trust_profile_attributes
SET attribute_key = 'registered_address'
WHERE source = 'companies_house'
  AND attribute_key = 'registered_office_address';
