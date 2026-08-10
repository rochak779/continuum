import { describe, expect, it } from "vitest";

import { FALLBACK_RULE, classifyChange } from "./engine";
import type { MaterialityInput, MaterialityRule } from "./types";

const baseInput: MaterialityInput = {
  provider: "mock_provider",
  attributeKey: "some_field",
  previousValue: "a",
  newValue: "b",
};

describe("classifyChange", () => {
  it("returns the first applicable rule's classification", () => {
    const first: MaterialityRule = {
      id: "first",
      appliesTo: () => true,
      classify: () => ({
        severity: "critical",
        explanation: "first fired",
        recommendedAction: "act now",
        ruleId: "first",
      }),
    };
    const second: MaterialityRule = {
      id: "second",
      appliesTo: () => true,
      classify: () => ({
        severity: "attention",
        explanation: "second fired",
        recommendedAction: "act later",
        ruleId: "second",
      }),
    };

    const result = classifyChange(baseInput, [first, second]);

    expect(result.ruleId).toBe("first");
    expect(result.explanation).toBe("first fired");
  });

  it("skips rules whose appliesTo returns false", () => {
    const skipped: MaterialityRule = {
      id: "skipped",
      appliesTo: () => false,
      classify: () => {
        throw new Error("must not be called");
      },
    };
    const matched: MaterialityRule = {
      id: "matched",
      appliesTo: (input) => input.attributeKey === "some_field",
      classify: () => ({
        severity: "attention",
        explanation: "matched fired",
        recommendedAction: "do the thing",
        ruleId: "matched",
      }),
    };

    const result = classifyChange(baseInput, [skipped, matched]);

    expect(result.ruleId).toBe("matched");
  });

  it("falls back to an informational classification when no rule matches", () => {
    const result = classifyChange(baseInput, []);

    expect(result.severity).toBe("info");
    expect(result.ruleId).toBe("fallback.informational");
    expect(result.explanation).toContain("some_field");
    expect(result.explanation).toContain("a");
    expect(result.explanation).toContain("b");
    expect(result.recommendedAction).toBeTruthy();
  });

  it("also falls back when every provided rule declines to apply", () => {
    const decline: MaterialityRule = {
      id: "decline",
      appliesTo: () => false,
      classify: () => FALLBACK_RULE.classify(baseInput),
    };

    const result = classifyChange(baseInput, [decline]);

    expect(result.ruleId).toBe("fallback.informational");
  });

  it("every result carries all three required ERD §21 fields", () => {
    const result = classifyChange(baseInput, []);

    expect(result.severity).toBeTruthy();
    expect(result.explanation).toBeTruthy();
    expect(result.recommendedAction).toBeTruthy();
  });

  it("fallback explanation renders null previous/new values as a placeholder rather than 'null'", () => {
    const result = classifyChange(
      {
        provider: "mock_provider",
        attributeKey: "some_field",
        previousValue: null,
        newValue: null,
      },
      [],
    );

    expect(result.explanation).not.toContain("null");
    expect(result.explanation).toContain("∅");
  });

  it("fallback explanation JSON-stringifies non-string values", () => {
    const result = classifyChange(
      {
        provider: "mock_provider",
        attributeKey: "some_field",
        previousValue: { a: 1 },
        newValue: { a: 2 },
      },
      [],
    );

    expect(result.explanation).toContain('{"a":1}');
    expect(result.explanation).toContain('{"a":2}');
  });
});
