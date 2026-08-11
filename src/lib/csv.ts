// Minimal dependency-free CSV parsing for vendor bulk import
// (src/routes/_authenticated/vendors/upload.tsx). No external CSV library is
// installed in this project, and the format we need to support (quoted
// fields, commas/newlines inside quotes) is small enough not to warrant one.

import type { VendorDraftRow } from "@/lib/vendor-options";

/** Parses raw CSV text into rows of string cells. Handles quoted fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank trailing rows produced by trailing newlines.
  return rows.filter((r) => !(r.length === 1 && (r[0] ?? "").trim() === ""));
}

type MappableField = Exclude<keyof VendorDraftRow, "id" | "source">;

const HEADER_ALIASES: Record<MappableField, string[]> = {
  company_name: ["company name", "company", "vendor name", "name"],
  companies_house_number: [
    "companies house number",
    "company number",
    "company registration number",
    "registration number",
    "ch number",
  ],
  country: ["country", "country of registration"],
  category: ["category", "vendor category"],
  internal_owner: ["internal owner", "owner", "internal vendor owner"],
  risk_level: ["risk level", "risk", "initial risk level"],
  email: ["email", "vendor email", "contact email"],
  internal_vendor_id: ["internal vendor id", "vendor id"],
};

const REQUIRED_COLUMNS: MappableField[] = ["company_name", "companies_house_number"];

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export interface CsvImportResult {
  rows: VendorDraftRow[];
  /** Header cells present in the file that didn't map to a known column. */
  unmappedHeaders: string[];
  /** Required columns (company_name, companies_house_number) not found in the header. */
  missingRequiredColumns: MappableField[];
}

/** Parses a vendor CSV export/template into draft rows via header matching. */
export function parseVendorCsv(text: string): CsvImportResult {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], unmappedHeaders: [], missingRequiredColumns: [...REQUIRED_COLUMNS] };
  }

  const headerRow = table[0] ?? [];
  const dataRows = table.slice(1);
  const columnMap: Partial<Record<MappableField, number>> = {};
  const unmappedHeaders: string[] = [];

  headerRow.forEach((rawHeader, index) => {
    const normalised = normaliseHeader(rawHeader);
    if (!normalised) return;
    const field = (Object.keys(HEADER_ALIASES) as MappableField[]).find((key) =>
      HEADER_ALIASES[key].includes(normalised),
    );
    if (field) columnMap[field] = index;
    else unmappedHeaders.push(rawHeader);
  });

  const missingRequiredColumns = REQUIRED_COLUMNS.filter((field) => columnMap[field] === undefined);

  const cell = (row: string[], field: MappableField): string => {
    const index = columnMap[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const rows: VendorDraftRow[] = dataRows
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row, index) => ({
      id: `csv-row-${index}-${Date.now()}`,
      company_name: cell(row, "company_name"),
      companies_house_number: cell(row, "companies_house_number"),
      country: cell(row, "country"),
      category: cell(row, "category"),
      internal_owner: cell(row, "internal_owner"),
      risk_level: cell(row, "risk_level"),
      email: cell(row, "email"),
      internal_vendor_id: cell(row, "internal_vendor_id"),
      source: "file",
    }));

  return { rows, unmappedHeaders, missingRequiredColumns };
}
