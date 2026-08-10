import type {
  CompaniesHouseAddress,
  DetectedChange,
  JsonValue,
  NormalisedCompanySnapshot,
  Severity,
} from "./types";

export type TrustProfile = Record<string, JsonValue>;

const RISK_STATUSES = new Set([
  "dissolved",
  "liquidation",
  "administration",
  "receivership",
  "receiver-action",
  "insolvency-proceedings",
  "voluntary-arrangement",
  "converted-closed",
  "closed",
  "removed",
]);

function statusSeverity(previous: JsonValue, next: JsonValue): Severity {
  const wasRisk = typeof previous === "string" && RISK_STATUSES.has(previous.toLowerCase());
  const isRisk = typeof next === "string" && RISK_STATUSES.has(next.toLowerCase());
  return isRisk && !wasRisk ? "critical" : "attention";
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function equal(previous: JsonValue, next: JsonValue): boolean {
  return canonicalJson(previous) === canonicalJson(next);
}

export function monitoredSnapshotValues(snapshot: NormalisedCompanySnapshot): TrustProfile {
  return {
    company_status: snapshot.companyStatus,
    company_name: snapshot.companyName,
    registered_address: snapshot.registeredOfficeAddress
      ? Object.fromEntries(
          Object.entries(snapshot.registeredOfficeAddress).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : null,
    sic_codes: snapshot.sicCodes,
  };
}

export function detectChanges(
  trustProfile: TrustProfile,
  snapshot: NormalisedCompanySnapshot,
): DetectedChange[] {
  const observed = monitoredSnapshotValues(snapshot);
  const changes: DetectedChange[] = [];

  for (const attribute of [
    "company_status",
    "company_name",
    "registered_address",
    "sic_codes",
  ] as const) {
    const previousValue = trustProfile[attribute] ?? null;
    const newValue = observed[attribute] ?? null;
    if (equal(previousValue, newValue)) continue;
    changes.push({
      attribute,
      previousValue,
      newValue,
      severity:
        attribute === "company_status"
          ? statusSeverity(previousValue, newValue)
          : "attention",
    });
  }

  return changes;
}

export function buildChangeDedupeKey(
  vendorId: string,
  source: string,
  change: DetectedChange,
): string {
  return [
    vendorId,
    source,
    change.attribute,
    canonicalJson(change.previousValue),
    canonicalJson(change.newValue),
  ].join("|");
}

export function formatChangeValue(value: JsonValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  const address = value as CompaniesHouseAddress;
  return [
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(", ");
}
