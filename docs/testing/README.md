# Companies House sandbox test fixtures

Dummy vendor data for demos and manual testing, generated via the Companies
House **Sandbox Test Data Generator API**
(`https://test-data-sandbox.company-information.service.gov.uk/test-data/company`,
auth: Basic with `COMPANIES_HOUSE_SANDBOX_API_KEY` as the username). This
service only exists in the sandbox environment — it can't create or affect
real companies.

## Files

- **`dummy-companies-house-data.json`** — the 5 generated companies in full:
  `company_number`, `company_name`, `company_status`, `jurisdiction`,
  registered address, and the `auth_code`/`company_uri` the generator
  returned. Kept for reference and for re-running Companies House API calls
  against these exact companies later. `auth_code` only matters if you need
  to file test transactions against one of these companies (e.g. via the
  Manipulate Company Data API) — it's sandbox-only and harmless if seen, but
  there's no reason to hand it out either.
- **`demo-vendors.csv`** — ready to upload via **Add Vendors → Add vendors by
  uploading a file** in the app. Matches the 3-column template
  (`Company Name`, `Companies House Number`, `Country`). Uploading it creates
  5 vendors whose Companies House numbers point at real (sandbox) company
  profiles, so monitoring activates immediately and pulls real status/address/
  SIC data for each.

## Why 5 different statuses

Each of the 5 companies was generated with a different `company_status` so
the dashboard shows visibly different states in a demo instead of 5 identical
"active" vendors:

| Company number | Status | Jurisdiction |
|---|---|---|
| 63667688 | active | england-wales |
| 26751737 | dissolved | england-wales |
| SC571202 | liquidation | scotland |
| 56914755 | administration | england-wales |
| NI626509 | voluntary-arrangement | northern-ireland |

## Regenerating

To generate a fresh batch (e.g. numbers get stale, or you want more variety):

```bash
source .env
curl -s -X POST "https://test-data-sandbox.company-information.service.gov.uk/test-data/company" \
  -u "${COMPANIES_HOUSE_SANDBOX_API_KEY}:" \
  -H "Content-Type: application/json" \
  -d '{"company_status":"active","jurisdiction":"england-wales"}'
```

Valid `company_status` values: `active`, `administration`, `closed`,
`converted-closed`, `dissolved`, `inactive`, `insolvency-proceedings`,
`liquidation`, `open`, `receivership`, `registered`, `removed`,
`voluntary-arrangement`. Valid `jurisdiction` values: `england-wales`,
`scotland`, `northern-ireland`.

The response gives you `company_number`; fetch the full profile from the
normal sandbox API (`GET /company/{number}` on
`api-sandbox.company-information.service.gov.uk`, same auth) to get the
generated `company_name` and address for the CSV.

`src/lib/csv.test.ts` has a test that parses `demo-vendors.csv` through the
app's real CSV import + validation code, so if this fixture ever breaks
(e.g. someone hand-edits it wrong), `npx vitest run` will catch it before a
demo does.
