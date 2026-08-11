-- supabase/migrations/20260811160000_vendor_document_expiry.sql
--
-- Adds item_label and expiry_date to vendor_documents so uploaded
-- documents can carry a human-readable label and an expiry date, either
-- AI-extracted (PDF/image) or manually entered (all other file types).
-- Both nullable: not every document has (or needs) an expiry date.

alter table public.vendor_documents
  add column item_label text,
  add column expiry_date date;
