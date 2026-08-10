// Shared types for the Companies House monitoring integration.
// Keep this file free of Node/Supabase imports so it can be used from both
// server code and unit tests without pulling in a runtime.

export const COMPANIES_HOUSE_SOURCE = "companies_house" as const;

// ---------------------------------------------------------------------------
// Raw API shape (only the fields we consume). The real payload is much larger;
// we keep the whole thing in `raw_response` for audit but normalise these.
// ---------------------------------------------------------------------------

export interface CompaniesHouseAddress {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  premises?: string;
  po_box?: string;
}

export interface CompaniesHouseRawProfile {
  company_number?: string;
  company_name?: string;
  company_status?: string;
  type?: string;
  registered_office_address?: CompaniesHouseAddress;
  date_of_creation?: string;
  jurisdiction?: string;
  sic_codes?: string[];
  accounts?: {
    next_due?: string;
    overdue?: boolean;
    next_accounts?: { due_on?: string; overdue?: boolean };
  };
  confirmation_statement?: {
    next_due?: string;
    overdue?: boolean;
  };
  // Anything else the API returns is preserved but not typed.
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalised internal representation. This is what we compare against and
// store column-by-column. Nulls are used consistently for "not provided".
// ---------------------------------------------------------------------------

export interface NormalisedCompanySnapshot {
  companyNumber: string;
  companyName: string | null;
  companyStatus: string | null;
  companyType: string | null;
  registeredOfficeAddress: CompaniesHouseAddress | null;
  dateOfCreation: string | null;
  jurisdiction: string | null;
  accountsNextDue: string | null;
  accountsStatus: string | null;
  confirmationStatementNextDue: string | null;
  sicCodes: string[];
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

export type Severity = "critical" | "attention" | "info";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DetectedChange {
  attribute: string;
  previousValue: JsonValue;
  newValue: JsonValue;
  severity: Severity;
}

// ---------------------------------------------------------------------------
// Adapter result — a discriminated union so callers must handle every failure
// mode explicitly rather than relying on thrown exceptions.
// ---------------------------------------------------------------------------

export type CompaniesHouseErrorType =
  | "invalid_company_number"
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "malformed_response"
  | "network_error";

export interface CompaniesHouseSuccess {
  ok: true;
  data: CompaniesHouseRawProfile;
}

export interface CompaniesHouseFailure {
  ok: false;
  errorType: CompaniesHouseErrorType;
  message: string;
  httpStatus?: number | undefined;
  retryAfterSeconds?: number | undefined;
}

export type CompaniesHouseResult = CompaniesHouseSuccess | CompaniesHouseFailure;
