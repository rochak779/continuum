import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseCsv, parseVendorCsv } from "./csv";
import { validateVendorRow } from "./vendor-validation";

describe("parseCsv", () => {
  it("splits simple rows on commas and newlines", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsv('name,note\n"Acme, Inc",hello\n')).toEqual([
      ["name", "note"],
      ["Acme, Inc", "hello"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsv('name\n"Say ""hi"""\n')).toEqual([["name"], ['Say "hi"']]);
  });
});

describe("parseVendorCsv", () => {
  it("maps aliased headers onto the canonical vendor fields", () => {
    const csv = "Company,Company Number,Country of Registration\nAcme Ltd,09876543,United Kingdom\n";
    const result = parseVendorCsv(csv);
    expect(result.missingRequiredColumns).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      company_name: "Acme Ltd",
      companies_house_number: "09876543",
      country: "United Kingdom",
    });
  });

  it("flags missing required columns instead of guessing", () => {
    const result = parseVendorCsv("Country\nUnited Kingdom\n");
    expect(result.missingRequiredColumns).toEqual(
      expect.arrayContaining(["company_name", "companies_house_number"]),
    );
  });

  it("skips fully-blank rows", () => {
    const result = parseVendorCsv("Company Name,Companies House Number\nAcme,09876543\n,\n");
    expect(result.rows).toHaveLength(1);
  });
});

describe("docs/testing/demo-vendors.csv fixture", () => {
  it("parses into 5 distinct, fully-valid vendor rows", () => {
    const text = readFileSync(resolve(__dirname, "../../docs/testing/demo-vendors.csv"), "utf-8");
    const { rows, missingRequiredColumns } = parseVendorCsv(text);

    expect(missingRequiredColumns).toEqual([]);
    expect(rows).toHaveLength(5);

    const numbers = new Set(rows.map((r) => r.companies_house_number));
    expect(numbers.size).toBe(5);

    for (const row of rows) {
      const { valid, fieldErrors } = validateVendorRow(row);
      expect(valid, `row ${row.company_name} had errors: ${JSON.stringify(fieldErrors)}`).toBe(
        true,
      );
    }
  });
});
