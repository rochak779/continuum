-- Current accepted vendor attributes. The first successful provider check
-- establishes these values; later observations must not overwrite them until
-- a change is explicitly accepted.
CREATE TABLE public.trust_profile_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  attribute_key text NOT NULL,
  current_value jsonb NOT NULL,
  source text NOT NULL,
  confidence text NOT NULL DEFAULT 'provider_reported'
    CHECK (confidence IN ('verified', 'provider_reported', 'unverified')),
  verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, attribute_key)
);

CREATE INDEX trust_profile_attributes_vendor_idx
  ON public.trust_profile_attributes(vendor_id);

GRANT SELECT ON public.trust_profile_attributes TO authenticated;
GRANT ALL ON public.trust_profile_attributes TO service_role;

ALTER TABLE public.trust_profile_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their vendor trust profile"
  ON public.trust_profile_attributes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = vendor_id AND v.owner_id = auth.uid()
  ));

CREATE TRIGGER update_trust_profile_attributes_updated_at
  BEFORE UPDATE ON public.trust_profile_attributes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
