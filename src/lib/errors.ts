/**
 * Extracts a human-readable message from a caught value. Supabase/PostgREST
 * errors are plain objects with a `.message` (and `.details`/`.hint`), not
 * `Error` instances — an `err instanceof Error` check silently swallows them
 * and hides the real reason behind a generic fallback.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
