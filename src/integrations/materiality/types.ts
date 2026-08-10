// Types for the materiality engine (ERD §21). Kept free of Node/Supabase
// imports so the engine is a pure, dependency-free function usable from
// server code, the future scheduler, and unit tests alike.

/** Mirrors change_events.severity / alerts.severity (docs/database-design.md §7-8). */
export type MaterialitySeverity = "critical" | "attention" | "info";

/**
 * One detected change, already diffed upstream (change detection is a
 * separate pipeline stage — ERD §19 step 4 — this engine only performs step
 * 5, "run materiality rules"). `attributeKey` follows the open vocabulary
 * established for trust_profile_attributes.attribute_key
 * (docs/database-design.md §4), e.g. "company_status", "legal_name".
 */
export interface MaterialityInput {
  provider: string;
  attributeKey: string;
  previousValue: unknown;
  newValue: unknown;
}

/**
 * Every classification carries all three ERD §21 fields — severity,
 * explanation, recommended action — so a caller never has to synthesize a
 * missing one. `ruleId` identifies which rule produced the result, purely
 * for testability/observability (e.g. logging which rule fired).
 */
export interface MaterialityResult {
  severity: MaterialitySeverity;
  explanation: string;
  recommendedAction: string;
  ruleId: string;
}

/**
 * A single deterministic rule. `appliesTo` decides whether the rule
 * matches a given change; `classify` produces its verdict. Split in two so
 * the engine can find "the first applicable rule" without committing to
 * classify every candidate.
 */
export interface MaterialityRule {
  id: string;
  appliesTo(input: MaterialityInput): boolean;
  classify(input: MaterialityInput): MaterialityResult;
}
