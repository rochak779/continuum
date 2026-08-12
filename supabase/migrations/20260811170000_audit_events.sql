-- supabase/migrations/20260811170000_audit_events.sql
--
-- Adds the audit_events table expected by src/integrations/audit/*
-- (record-audit-event.server.ts). It previously only existed in
-- supabase/migrations_archived/20260810130000_core_monitoring_schema.sql,
-- from an earlier organisation-based schema design that predates the
-- current owner_id-based one -- it was never re-added when that schema
-- changed. Recreated here scoped to the current schema: organisation_id is
-- kept (record-audit-event.server.ts always writes one) but as a plain uuid
-- with no FK, since there is no organisations table in the current schema;
-- RLS is scoped via vendor ownership like every other monitoring table
-- instead of via organisation membership.
--
-- Note: this table has no writer wired to real data yet -- the only current
-- caller (resolve-alert.server.ts, via src/integrations/alerts/) itself
-- queries tables ("alerts", "change_events") that don't exist in this
-- schema either, a separate pre-existing issue tracked outside this
-- migration. This table is still worth adding now: it's additive, matches
-- the audit writer's actual column expectations, and unblocks the AI
-- assistant's getVendorAuditHistory tool for whenever that separate issue
-- is fixed.

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'service')),
  actor_id uuid,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_vendor_created_idx
  ON public.audit_events(vendor_id, created_at DESC) WHERE vendor_id IS NOT NULL;

-- Strictly append-only: no UPDATE/DELETE grant to any role, including
-- service_role (matches the archived migration's intent).
GRANT SELECT ON public.audit_events TO authenticated;
GRANT SELECT, INSERT ON public.audit_events TO service_role;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Vendor-level events only (vendor_id IS NOT NULL) are visible to their
-- owner, same join pattern as every other monitoring table. There is no
-- organisation concept in the current schema, so organisation-level events
-- (vendor_id IS NULL) have no owner to scope by and are not selectable by
-- `authenticated` under this policy -- consistent with nothing currently
-- writing them.
CREATE POLICY "Owners can view their vendor audit events"
  ON public.audit_events FOR SELECT TO authenticated
  USING (
    vendor_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.owner_id = auth.uid()
    )
  );
