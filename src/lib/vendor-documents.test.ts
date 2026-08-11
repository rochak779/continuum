import { describe, expect, it } from "vitest";

import { formatFileSize, MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "./vendor-documents";

describe("validateDocumentFile", () => {
  it("accepts an allowed extension under the size limit", () => {
    expect(validateDocumentFile({ name: "insurance.pdf", size: 1024 })).toEqual({ valid: true });
  });

  it("is case-insensitive on the extension", () => {
    expect(validateDocumentFile({ name: "insurance.PDF", size: 1024 })).toEqual({ valid: true });
  });

  it("rejects a disallowed extension", () => {
    const result = validateDocumentFile({ name: "insurance.zip", size: 1024 });
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/type/i);
  });

  it("rejects a file with no extension", () => {
    const result = validateDocumentFile({ name: "insurance", size: 1024 });
    expect(result.valid).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateDocumentFile({ name: "insurance.pdf", size: MAX_DOCUMENT_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/size|large|10\s*MB/i);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateDocumentFile({ name: "insurance.pdf", size: MAX_DOCUMENT_SIZE_BYTES })).toEqual({
      valid: true,
    });
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
  });
});
