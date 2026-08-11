//
// Coerces the AI model's raw `expiryDate` output into a valid ISO date
// string (YYYY-MM-DD) or null. The model is prompted to return an ISO date
// or null, but structured output doesn't guarantee well-formed date
// strings — this is the safety net before the value ever reaches the DB.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i;
const DATE_LIKE_PATTERN = /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}/;

export function normalizeExtractedDate(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;

  const trimmed = value.trim();
  if (ISO_DATE_PATTERN.test(trimmed)) {
    // Already ISO — still verify it's a real calendar date (e.g. reject "2027-02-31").
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : trimmed;
  }

  // Only try to parse if it looks like it contains date-like content
  // (month names or common date separators with numbers)
  if (!MONTH_NAMES.test(trimmed) && !DATE_LIKE_PATTERN.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}
