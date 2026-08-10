ALTER TABLE public.trust_profile_attributes
  ADD COLUMN updated_from_change_event_id uuid
    REFERENCES public.vendor_change_events(id) ON DELETE SET NULL;

ALTER TABLE public.vendor_monitoring_alerts
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN resolution_type text
    CHECK (resolution_type IN ('verified_accepted', 'false_positive', 'risk_accepted'));

-- Alert verification is a single transaction: accept the observed value,
-- resolve its event and alert, and retain the event's immutable old value.
CREATE OR REPLACE FUNCTION public.verify_vendor_monitoring_alert(p_alert_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  selected_alert public.vendor_monitoring_alerts%ROWTYPE;
  selected_event public.vendor_change_events%ROWTYPE;
  actor_id uuid := auth.uid();
BEGIN
  SELECT a.* INTO selected_alert
  FROM vendor_monitoring_alerts a
  JOIN vendors v ON v.id = a.vendor_id
  WHERE a.id = p_alert_id
    AND v.owner_id = actor_id
    AND a.status <> 'resolved'
  FOR UPDATE OF a;

  IF NOT FOUND OR selected_alert.change_event_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO selected_event FROM vendor_change_events
  WHERE id = selected_alert.change_event_id
    AND vendor_id = selected_alert.vendor_id;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO trust_profile_attributes (
    vendor_id, attribute_key, current_value, source, confidence,
    verified_at, updated_from_change_event_id
  ) VALUES (
    selected_event.vendor_id, selected_event.attribute_key,
    coalesce(selected_event.new_value, 'null'::jsonb),
    selected_event.source, 'verified', now(), selected_event.id
  )
  ON CONFLICT (vendor_id, attribute_key) DO UPDATE SET
    current_value = EXCLUDED.current_value,
    source = EXCLUDED.source,
    confidence = 'verified',
    verified_at = EXCLUDED.verified_at,
    updated_from_change_event_id = EXCLUDED.updated_from_change_event_id;

  UPDATE vendor_change_events SET status = 'resolved' WHERE id = selected_event.id;
  UPDATE vendor_monitoring_alerts SET
    status = 'resolved', resolved_at = now(), resolved_by = actor_id,
    resolution_type = 'verified_accepted'
  WHERE id = selected_alert.id;
  RETURN true;
END;
$$;

REVOKE UPDATE ON public.vendor_monitoring_alerts FROM authenticated;
REVOKE ALL ON FUNCTION public.verify_vendor_monitoring_alert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_vendor_monitoring_alert(uuid) TO authenticated;
