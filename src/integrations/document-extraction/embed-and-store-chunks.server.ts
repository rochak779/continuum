// Server-only: wires embedAndStoreChunks (pure) to the real Google
// embedding model and Supabase. Best-effort — mirrors
// extract-document-fields.server.ts: any failure here must never surface
// as an upload failure, since it only affects whether the document is
// searchable via the AI assistant.
//
// document_chunks predates the generated Database types
// (supabase/migrations/20260811180000) -- table access here is typed by
// hand, same convention as record-audit-event.server.ts.

import { google } from "@ai-sdk/google";
import { embedMany } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { embedAndStoreChunks, type EmbedAndStoreChunksInput } from "./embed-and-store-chunks";

// Untyped on purpose -- see file header.
type ScopedClient = SupabaseClient;

export async function embedAndStoreDocumentChunks(
  db: ScopedClient,
  input: EmbedAndStoreChunksInput,
): Promise<{ chunksStored: number }> {
  try {
    return await embedAndStoreChunks(
      {
        async embedChunks(chunks) {
          const { embeddings } = await embedMany({
            model: google.textEmbeddingModel("text-embedding-004"),
            values: chunks,
          });
          return embeddings;
        },
        async insertChunks(rows) {
          const { error } = await db.from("document_chunks").insert(
            rows.map((row) => ({
              vendor_document_id: row.vendorDocumentId,
              vendor_id: row.vendorId,
              owner_id: row.ownerId,
              chunk_index: row.chunkIndex,
              content: row.content,
              embedding: row.embedding,
            })),
          );
          if (error) throw error;
        },
      },
      input,
    );
  } catch (err) {
    console.error("[document-extraction] Chunking/embedding failed:", err);
    return { chunksStored: 0 };
  }
}
