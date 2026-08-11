export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "doc",
  "docx",
  "xls",
  "xlsx",
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export type DocumentValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Client-side gate before a file reaches Supabase Storage. The bucket's
 * own file_size_limit/allowed_mime_types are the backstop — this just
 * gives the user immediate, specific feedback instead of a generic
 * Storage error.
 */
export function validateDocumentFile(file: { name: string; size: number }): DocumentValidationResult {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      valid: false,
      reason: `Unsupported file type. Allowed: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}`,
    };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { valid: false, reason: "File is larger than the 10 MB limit" };
  }
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
