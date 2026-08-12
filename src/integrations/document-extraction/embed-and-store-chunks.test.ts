import { describe, expect, it } from "vitest";

import { embedAndStoreChunks } from "./embed-and-store-chunks";
import type { ChunkEmbedder, DocumentChunkRow } from "./embed-and-store-chunks";

function createFakeEmbedder(overrides: Partial<ChunkEmbedder> = {}): {
  embedder: ChunkEmbedder;
  inserted: DocumentChunkRow[];
} {
  const inserted: DocumentChunkRow[] = [];
  const embedder: ChunkEmbedder = {
    async embedChunks(chunks) {
      return chunks.map((_, i) => [i, i, i]);
    },
    async insertChunks(rows) {
      inserted.push(...rows);
    },
    ...overrides,
  };
  return { embedder, inserted };
}

const BASE_INPUT = {
  vendorDocumentId: "doc-1",
  vendorId: "vendor-1",
  ownerId: "owner-1",
};

describe("embedAndStoreChunks", () => {
  it("chunks the text, embeds each chunk, and inserts one row per chunk", async () => {
    const { embedder, inserted } = createFakeEmbedder();
    const text = "0123456789".repeat(150); // 1500 chars -> multiple chunks at default size

    const result = await embedAndStoreChunks(embedder, { ...BASE_INPUT, extractedText: text });

    expect(result.chunksStored).toBeGreaterThan(1);
    expect(inserted).toHaveLength(result.chunksStored);
    expect(inserted[0]).toMatchObject({
      vendorDocumentId: "doc-1",
      vendorId: "vendor-1",
      ownerId: "owner-1",
      chunkIndex: 0,
    });
    expect(inserted[1]!.chunkIndex).toBe(1);
  });

  it("stores nothing for empty extracted text", async () => {
    const { embedder, inserted } = createFakeEmbedder();

    const result = await embedAndStoreChunks(embedder, { ...BASE_INPUT, extractedText: "" });

    expect(result).toEqual({ chunksStored: 0 });
    expect(inserted).toHaveLength(0);
  });

  it("stores nothing for whitespace-only extracted text", async () => {
    const { embedder, inserted } = createFakeEmbedder();

    const result = await embedAndStoreChunks(embedder, { ...BASE_INPUT, extractedText: "   \n  " });

    expect(result).toEqual({ chunksStored: 0 });
    expect(inserted).toHaveLength(0);
  });

  it("truncates extracted text longer than the max length before chunking", async () => {
    const { embedder, inserted } = createFakeEmbedder();
    const text = "x".repeat(60_000); // over the 50,000-char cap

    await embedAndStoreChunks(embedder, { ...BASE_INPUT, extractedText: text });

    const totalStoredChars = inserted.reduce((sum, row) => sum + row.content.length, 0);
    // Overlap means stored chars can exceed the cap somewhat, but not the
    // full 60,000 -- confirms truncation happened before chunking.
    expect(totalStoredChars).toBeLessThan(60_000);
  });
});
