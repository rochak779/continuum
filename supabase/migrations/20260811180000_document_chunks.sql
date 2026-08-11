-- supabase/migrations/20260811180000_document_chunks.sql
--
-- Adds pgvector-backed semantic search over vendor document content, for
-- the AI assistant's searchVendorDocuments tool
-- (src/integrations/assistant/store.server.ts). Chunks are written by
-- src/integrations/document-extraction/embed-and-store-chunks.server.ts
-- after a document is saved to vendor_documents, using the document's
-- Gemini-transcribed text (extract-document-fields.server.ts).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_document_id uuid NOT NULL REFERENCES public.vendor_documents(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_document_id, chunk_index)
);

CREATE INDEX document_chunks_vendor_document_idx ON public.document_chunks(vendor_document_id);
CREATE INDEX document_chunks_owner_idx ON public.document_chunks(owner_id);
-- ivfflat needs rows to build a good index; fine to create now near-empty
-- and let it improve as data grows -- same trade-off Supabase's own docs
-- make for this pattern.
CREATE INDEX document_chunks_embedding_idx ON public.document_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

GRANT SELECT, INSERT ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own document chunks"
  ON public.document_chunks FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert their own document chunks"
  ON public.document_chunks FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Cosine-similarity search, callable via supabase.rpc(). match_owner_id is
-- always supplied by the caller (src/integrations/assistant/store.server.ts)
-- as the authenticated user's id -- never accepted from model-controlled
-- tool-call input (see src/integrations/assistant/tools.ts). RLS on
-- document_chunks independently enforces the same boundary for
-- defense-in-depth: this function runs SECURITY INVOKER (the Postgres
-- default), so it executes as the calling authenticated user.
CREATE FUNCTION public.match_document_chunks(
  query_embedding vector(768),
  match_owner_id uuid,
  match_vendor_id uuid DEFAULT NULL,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  vendor_id uuid,
  vendor_name text,
  file_name text,
  content text,
  similarity float
)
LANGUAGE sql STABLE AS $$
  SELECT
    dc.vendor_id,
    v.company_name AS vendor_name,
    vd.file_name,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  JOIN public.vendors v ON v.id = dc.vendor_id
  JOIN public.vendor_documents vd ON vd.id = dc.vendor_document_id
  WHERE dc.owner_id = match_owner_id
    AND (match_vendor_id IS NULL OR dc.vendor_id = match_vendor_id)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks TO authenticated;
