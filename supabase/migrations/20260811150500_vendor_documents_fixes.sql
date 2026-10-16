-- supabase/migrations/20260811150500_vendor_documents_fixes.sql
--
-- Fixes for 20260811150000_vendor_documents.sql:
-- 1. continuum.vendor_documents had no GRANTs, so Postgres rejected every query
--    with "permission denied for table vendor_documents" before RLS was even
--    evaluated (this project has no ALTER DEFAULT PRIVILEGES granting blanket
--    access, unlike e.g. continuum.vendors, which pairs its CREATE TABLE with
--    explicit GRANTs).
-- 2. owner_id had no foreign key to auth.users(id) / on delete cascade,
--    unlike the equivalent column on continuum.vendors.

grant select, insert, delete on continuum.vendor_documents to authenticated;
grant all on continuum.vendor_documents to service_role;

alter table continuum.vendor_documents
  add constraint vendor_documents_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;
