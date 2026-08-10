// Resolves which Companies House environment (sandbox or production) the app
// talks to, and the matching API key + base URL pair.
//
// Server-only: reads process.env directly, must never be imported from
// client code (same rule as provider.server.ts / monitor.server.ts).
//
// Controlled by COMPANIES_HOUSE_ENV:
//   "production" -> real Companies House data, COMPANIES_HOUSE_API_KEY
//   "sandbox"     -> Companies House sandbox test data,
//                    COMPANIES_HOUSE_SANDBOX_API_KEY
//   unset/unrecognised -> defaults to "sandbox". This is a deliberate
//   fail-safe: a missing/misconfigured env var should never silently start
//   spending production API quota or writing real company data into a test
//   environment. Going live requires explicitly setting
//   COMPANIES_HOUSE_ENV=production.

export type CompaniesHouseEnv = "sandbox" | "production";

const PRODUCTION_BASE_URL = "https://api.company-information.service.gov.uk";
const SANDBOX_BASE_URL = "https://api-sandbox.company-information.service.gov.uk";

export interface CompaniesHouseConfig {
  env: CompaniesHouseEnv;
  apiKey: string;
  baseUrl: string;
}

function resolveEnv(): CompaniesHouseEnv {
  return process.env["COMPANIES_HOUSE_ENV"] === "production" ? "production" : "sandbox";
}

/**
 * Resolve the active Companies House environment's API key and base URL from
 * process.env. Callers needing to override for tests should pass explicit
 * `apiKey`/`baseUrl` options to the provider/client instead of calling this.
 */
export function resolveCompaniesHouseConfig(): CompaniesHouseConfig {
  const env = resolveEnv();
  if (env === "production") {
    return {
      env,
      apiKey: process.env["COMPANIES_HOUSE_API_KEY"] ?? "",
      baseUrl: PRODUCTION_BASE_URL,
    };
  }
  return {
    env,
    apiKey: process.env["COMPANIES_HOUSE_SANDBOX_API_KEY"] ?? "",
    baseUrl: SANDBOX_BASE_URL,
  };
}
