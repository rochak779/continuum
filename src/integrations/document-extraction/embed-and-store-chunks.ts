//
// Pure orchestration: chunk -> embed -> insert, against an injected
// ChunkEmbedder (same store-injection pattern as resolveAlert/
// AlertResolutionStore). embed-and-store-chunks.server.ts wires the real
// Google embedding model + Supabase insert; this file is what's tested.

import { chunkText } from "./chunk-text";

// Guardrail against runaway embedding cost on a huge document (design spec
// §Guardrails "output size caps" -- this is the input-side equivalent).
const MAX_EXTRACTED_TEXT_LENGTH = 50_000;

export interface DocumentChunkRow {
  vendorDocumentId: string;
  vendorId: string;
  ownerId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface ChunkEmbedder {
  embedChunks(chunks: string[]): Promise<number[][]>;
  insertChunks(rows: DocumentChunkRow[]): Promise<void>;
}

export interface EmbedAndStoreChunksInput {
  vendorDocumentId: string;
  vendorId: string;
  ownerId: string;
  extractedText: string;
}

export async function embedAndStoreChunks(
  embedder: ChunkEmbedder,
  input: EmbedAndStoreChunksInput,
): Promise<{ chunksStored: number }> {
  const text = input.extractedText.trim().slice(0, MAX_EXTRACTED_TEXT_LENGTH);
  if (text.length === 0) return { chunksStored: 0 };

  const chunks = chunkText(text);
  if (chunks.length === 0) return { chunksStored: 0 };

  const embeddings = await embedder.embedChunks(chunks);
  const rows: DocumentChunkRow[] = chunks.map((content, i) => ({
    vendorDocumentId: input.vendorDocumentId,
    vendorId: input.vendorId,
    ownerId: input.ownerId,
    chunkIndex: i,
    content,
    embedding: embeddings[i]!,
  }));

  await embedder.insertChunks(rows);
  return { chunksStored: rows.length };
}
