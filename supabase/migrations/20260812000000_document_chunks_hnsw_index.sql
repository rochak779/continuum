-- supabase/migrations/20260812000000_document_chunks_hnsw_index.sql
--
-- Supersedes the ivfflat index created in 20260811180000_document_chunks.sql.
-- ivfflat computes its centroids via k-means at *build* time; building it
-- against an empty (or near-empty) table produces degenerate centroids that
-- never self-correct as rows are added later -- the comment in the earlier
-- migration claiming it would "improve as data grows" was wrong. HNSW does
-- not require build-time data to produce a good index, so it doesn't have
-- this problem.

DROP INDEX IF EXISTS public.document_chunks_embedding_idx;

CREATE INDEX document_chunks_embedding_idx ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops);
