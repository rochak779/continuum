// Public entry point for the materiality engine (ERD §21).

export { classifyChange, FALLBACK_RULE } from "./engine";
export {
  COMPANIES_HOUSE_MATERIALITY_RULES,
  COMPANIES_HOUSE_PROVIDER,
  isRiskCompanyStatus,
} from "./companies-house-rules";
export type {
  MaterialityInput,
  MaterialityResult,
  MaterialityRule,
  MaterialitySeverity,
} from "./types";

import { classifyChange } from "./engine";
import {
  COMPANIES_HOUSE_MATERIALITY_RULES,
  COMPANIES_HOUSE_PROVIDER,
} from "./companies-house-rules";
import type { MaterialityResult } from "./types";

/**
 * Convenience wrapper: classify a Companies House change without callers
 * having to know/import the rule set directly.
 */
export function classifyCompaniesHouseChange(input: {
  attributeKey: string;
  previousValue: unknown;
  newValue: unknown;
}): MaterialityResult {
  return classifyChange(
    { provider: COMPANIES_HOUSE_PROVIDER, ...input },
    COMPANIES_HOUSE_MATERIALITY_RULES,
  );
}
