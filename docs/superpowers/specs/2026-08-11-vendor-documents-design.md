# Vendor Documents — Design

Date: 2026-08-11
Status: Approved

## Context

The vendors list (`src/routes/_authenticated/vendors/index.tsx`) shows
company, category, country, owner, risk, and monitoring status per vendor.
There is no way to attach supporting files (e.g. insurance certificates) to
a vendor, and no Supabase Storage bucket exists in the project yet. Vendor
rows are not clickable and there is no per-vendor detail page.

## Goal

For every vendor in the list, show whether any document has been uploaded,
and let the internal (logged-in) user upload/view/delete files for that
vendor — without adding a new page.

## Non-goals

- External vendor/customer upload portal (public, no-login upload link).
  Uploads are internal-team-only for this pass.
- A fixed/required document checklist (e.g. "must have Insurance Cert,
  W9, NDA"). This is an open-ended, flat list of files per vendor.
- File versioning or replacing a file in place — removing a file is a
  delete, adding a new one is a separate upload.
- A dedicated vendor detail page — documents live inline in the existing
  table.

## Design

### Data model

New table `public.vendor_documents`, RLS-scoped the same way as
`vendors` (`owner_id = auth.uid()`, matching the pattern in
`supabase/migrations/20260810111100_*.sql`):

```sql
create table public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  owner_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_size bigint not null,
  content_type text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index vendor_documents_vendor_id_idx on public.vendor_documents(vendor_id);

alter table public.vendor_documents enable row level security;

create policy "Users can view their own vendor documents"
  on public.vendor_documents for select to authenticated
  using (owner_id = auth.uid());
create policy "Users can insert their own vendor documents"
  on public.vendor_documents for insert to authenticated
  with check (owner_id = auth.uid());
create policy "Users can delete their own vendor documents"
  on public.vendor_documents for delete to authenticated
  using (owner_id = auth.uid());
```

No update policy — replacing a file is a delete + insert.

### Storage

New private Supabase Storage bucket `vendor-documents` (created via
migration using `storage.buckets`/`storage.objects` policies, consistent
with how the rest of the schema is migration-driven). Object path
convention: `{owner_id}/{vendor_id}/{uuid}-{original_file_name}`, so
Storage RLS can reuse `owner_id = auth.uid()` by parsing the path's first
segment — same ownership model as the table, no cross-referencing needed.

Bucket-level file size limit set to 10MB as a backstop; allowed MIME types
restricted to pdf/png/jpg/jpeg/doc/docx/xls/xlsx at the bucket config
level, with the same list enforced client-side before upload so users get
an immediate, friendly rejection instead of a Storage error.

### UI — inline in the vendors table

New **Documents** column added to the existing table in
`vendors/index.tsx`, between Status and the row end (or wherever reads
cleanly — final placement is a small implementation-time call).

Cell states, driven by a per-vendor document count:

- **0 documents:** muted text "No document uploaded" + a small "Upload"
  button/icon.
- **N documents:** a clickable chip, e.g. "3 documents". Clicking opens a
  popover listing each file (name, size, uploaded date) with a download
  link and a delete (trash) icon per row, plus an "Upload more" action at
  the bottom of the popover.

Upload is a native `<input type="file" multiple>` triggered by the
button/popover action — no modal dialog needed for this. On file select:
validate type + 10MB size client-side, reject with an inline message if
invalid, otherwise upload to Storage then insert the `vendor_documents`
row, then invalidate the vendor documents query for that vendor so the
cell updates.

Delete: removes the Storage object and the `vendor_documents` row
together; on partial failure (row deleted but Storage object orphaned, or
vice versa) surface an inline error — cleanup of true orphans is a rare
edge case not worth extra machinery for v1.

### Components / hooks

- `src/components/app/VendorDocumentsCell.tsx` — the table cell: renders
  the status/chip, owns the popover, wires up upload/delete.
- `src/lib/vendor-documents.ts` — pure helpers: file validation
  (type/size check) and any display formatting (file size, relative
  date), unit-testable without React or Supabase.
- Data access via react-query, colocated in `VendorDocumentsCell.tsx` or a
  small `useVendorDocuments(vendorId)` hook: one query per vendor row for
  document list/count, plus upload/delete mutations that invalidate that
  vendor's query key on success.

Fetching one query per row (rather than a single batched query for all
vendors) matches the simplicity of the existing page and keeps the cell
self-contained; revisit only if the vendor list grows large enough to
make N+1 queries a real problem.

### Error handling / UX

- Upload button shows a spinner/disabled state while in flight.
- Invalid file (wrong type or >10MB): inline error text near the upload
  control, upload not attempted.
- Upload/delete failure (network, RLS): inline error message in the
  popover, state unchanged so the user can retry.
- Documents column shows a small loading state (e.g. "…") while its query
  is in flight, consistent with the rest of the table's `isLoading`
  handling.

### Testing

Consistent with this codebase's existing pattern (logic-only `*.test.ts`):

- Unit test `src/lib/vendor-documents.ts`: file type/size validation
  function, and any formatting helpers.
- No React component tests (matches existing convention — none exist in
  the repo).

## Open questions / follow-ups (not part of this spec)

- External vendor self-upload portal (would need public auth-less upload
  flow + security review).
- Fixed/required document types per vendor with compliance tracking.
- Batched single-query fetch for all vendors' document counts if the
  per-row query approach becomes a performance issue.
