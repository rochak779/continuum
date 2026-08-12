// src/integrations/document-extraction/chunk-text.test.ts
import { describe, expect, it } from "vitest";

import { chunkText } from "./chunk-text";

describe("chunkText", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns an empty array for whitespace-only input", () => {
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("returns one chunk when text is shorter than chunkSize", () => {
    const text = "A short document about an insurance policy.";
    expect(chunkText(text, { chunkSize: 1000, overlap: 150 })).toEqual([text]);
  });

  it("splits text longer than chunkSize into overlapping chunks", () => {
    const text = "0123456789".repeat(30); // 300 chars
    const chunks = chunkText(text, { chunkSize: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk except the last is exactly chunkSize long.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk).toHaveLength(100);
    }
    // Consecutive chunks overlap by exactly `overlap` characters.
    expect(chunks[0]!.slice(-20)).toBe(chunks[1]!.slice(0, 20));
    // Every character of the original text is covered.
    expect(chunks.join("").length).toBeGreaterThanOrEqual(text.length);
  });

  it("uses default chunkSize/overlap when none given", () => {
    const text = "x".repeat(2500);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toHaveLength(1000);
  });

  it("throws for a non-positive chunkSize", () => {
    expect(() => chunkText("hello world", { chunkSize: 0 })).toThrow("chunkSize must be positive");
  });

  it("throws when overlap is not less than chunkSize", () => {
    expect(() => chunkText("hello world", { chunkSize: 100, overlap: 100 })).toThrow(
      "overlap must be >= 0 and < chunkSize",
    );
  });
});
