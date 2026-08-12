//
// Pure, deterministic character-based chunking for feeding a document's
// extracted text to an embedding model (see embed-and-store-chunks.ts).
// No semantic/sentence-aware splitting -- fixed-size sliding window with
// overlap is enough for v1 (see design spec's Architecture section).

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

export function chunkText(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): string[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (chunkSize <= 0) throw new Error("chunkSize must be positive");
  if (overlap < 0 || overlap >= chunkSize) {
    throw new Error("overlap must be >= 0 and < chunkSize");
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + chunkSize, trimmed.length);
    chunks.push(trimmed.slice(start, end));
    if (end >= trimmed.length) break;
    start = end - overlap;
  }
  return chunks;
}
