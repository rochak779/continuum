import { normaliseCompanyNumber } from "./client";

export function matchesMonitoredCompanyNumber(
  storedCompanyNumber: string | null,
  requestedCompanyNumber: string,
): boolean {
  if (!storedCompanyNumber) return false;
  const stored = normaliseCompanyNumber(storedCompanyNumber);
  const requested = normaliseCompanyNumber(requestedCompanyNumber);
  return stored !== null && requested !== null && stored === requested;
}
