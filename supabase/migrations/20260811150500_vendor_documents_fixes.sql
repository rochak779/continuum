-- supabase/migrations/20260811150500_vendor_documents_fixes.sql
--
-- Fixes for 20260811150000_vendor_documents.sql:
-- 1. public.vendor_documents had no GRANTs, so Postgres rejected every query
--    with "permission denied for table vendor_documents" before RLS was even
--    evaluated (this project has no ALTER DEFAULT PRIVILEGES granting blanket
--    access, unlike e.g. public.vendors, which pairs its CREATE TABLE with
--    explicit GRANTs).
-- 2. owner_id had no foreign key to auth.users(id) / on delete cascade,
--    unlike the equivalent column on public.vendors.

grant select, insert, delete on public.vendor_documents to authenticated;
grant all on public.vendor_documents to service_role;

alter table public.vendor_documents
  add constraint vendor_documents_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;
