-- supabase/migrations/20260811150000_vendor_documents.sql

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

-- Storage bucket for the actual files. Objects are stored under
-- {owner_id}/{vendor_id}/{uuid}-{filename}, so Storage RLS can check
-- ownership from the first path segment without joining back to
-- vendor_documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-documents',
  'vendor-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create policy "Users can view their own vendor document objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own vendor document objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own vendor document objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);
