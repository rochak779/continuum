// The materiality engine (ERD §21): a deterministic, rule-based
// classifier that turns one detected change into a severity + explanation +
// recommended action. No AI/LLM involved anywhere in this module, by
// design — ERD §21 is explicit that MVP severity must come from
// deterministic rules, and ERD §35/§997 lists "AI-based materiality
// classification" as an explicit non-goal.
//
// The engine itself knows nothing about any particular provider's
// attributes; it just evaluates an ordered list of MaterialityRule objects
// and returns the first match. Provider-specific rule sets (e.g.
// ../companies-house/materiality-rules.ts) plug in via `rules`.

import type { MaterialityInput, MaterialityResult, MaterialityRule } from "./types";

/**
 * The rule every input eventually falls back to when no provider-specific
 * rule matches (ERD §21 "Informational: non-risk metadata changes"). Always
 * applicable, always last, so the engine never fails to produce a result.
 */
export const FALLBACK_RULE: MaterialityRule = {
  id: "fallback.informational",
  appliesTo: () => true,
  classify: (input) => ({
    severity: "info",
    explanation: `"${input.attributeKey}" changed from ${describe(input.previousValue)} to ${describe(input.newValue)}.`,
    recommendedAction: "No action required; the change has been recorded for the vendor's history.",
    ruleId: "fallback.informational",
  }),
};

function describe(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Classify one detected change. Evaluates `rules` in order and returns the
 * first match; `rules` should end with (or the caller should append)
 * FALLBACK_RULE so every input, including attribute keys no rule set
 * recognizes, still produces a deterministic informational result rather
 * than throwing.
 */
export function classifyChange(
  input: MaterialityInput,
  rules: readonly MaterialityRule[],
): MaterialityResult {
  for (const rule of rules) {
    if (rule.appliesTo(input)) {
      return rule.classify(input);
    }
  }
  return FALLBACK_RULE.classify(input);
}
