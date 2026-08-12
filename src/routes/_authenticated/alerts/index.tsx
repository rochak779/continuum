import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { alertAttributeLabel } from "@/lib/alert-labels";

export const Route = createFileRoute("/_authenticated/alerts/")({
  head: () => ({
    meta: [
      { title: "Alerts | Continuum" },
      {
        name: "description",
        content: "Review and investigate open vendor monitoring alerts in Continuum.",
      },
      { property: "og:title", content: "Alerts | Continuum" },
      { property: "og:description", content: "Investigate vendor monitoring alerts in Continuum." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AlertsPage,
});

interface AlertListRow {
  id: string;
  vendor_id: string;
  severity: string;
  status: string;
  attribute_checked: string;
  detected_at: string;
  vendors: { company_name: string } | null;
}

function vendorName(vendor: AlertListRow["vendors"]): string {
  return vendor?.company_name ?? "Unknown vendor";
}

/** Groups alerts (already sorted newest-first) by calendar day, preserving order. */
function groupByDate(alerts: AlertListRow[]): Array<{ dateKey: string; alerts: AlertListRow[] }> {
  const groups: Array<{ dateKey: string; alerts: AlertListRow[] }> = [];
  for (const alert of alerts) {
    const dateKey = new Date(alert.detected_at).toDateString();
    const current = groups.at(-1);
    if (current?.dateKey === dateKey) {
      current.alerts.push(alert);
    } else {
      groups.push({ dateKey, alerts: [alert] });
    }
  }
  return groups;
}

function formatDateHeading(dateKey: string): string {
  const date = new Date(dateKey);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
  if (dateKey === today) return "Today";
  if (dateKey === yesterday) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function AlertsPage() {
  const { data: alerts, isLoading, isError, error } = useQuery({
    queryKey: ["alerts", "list"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("vendor_monitoring_alerts")
        .select("id, vendor_id, severity, status, attribute_checked, detected_at, vendors ( company_name )")
        .order("detected_at", { ascending: false });
      if (queryError) throw queryError;
      return data as AlertListRow[];
    },
  });

  const groups = groupByDate(alerts ?? []);

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vendor monitoring alerts across your organisation, newest first.
        </p>
      </div>

      {isError ? (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-error-container px-4 py-3 text-sm text-on-error-container">
          Alerts could not be loaded. {error instanceof Error ? error.message : "Try again."}
        </div>
      ) : isLoading ? (
        <p className="mt-8 p-8 text-muted-foreground">Loading alerts…</p>
      ) : groups.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-border bg-card p-8 text-muted-foreground shadow-card">
          No alerts yet. They'll appear here once vendor monitoring detects a material change.
        </p>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((group) => (
            <div key={group.dateKey}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {formatDateHeading(group.dateKey)}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-6 py-4">Alert</th>
                      <th className="px-6 py-4">Vendor</th>
                      <th className="px-6 py-4">Severity</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Detected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.alerts.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-6 py-4">
                          <Link
                            to="/alerts/$alertId"
                            params={{ alertId: a.id }}
                            className="font-semibold text-foreground hover:text-primary hover:underline"
                          >
                            {alertAttributeLabel(a.attribute_checked)} change
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">{vendorName(a.vendors)}</td>
                        <td className="px-6 py-4">
                          <SeverityChip severity={a.severity} />
                        </td>
                        <td className="px-6 py-4">
                          <StatusChip status={a.status} />
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">
                          {new Date(a.detected_at).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  const tone =
    severity === "critical"
      ? "bg-error-container text-on-error-container"
      : severity === "info"
        ? "bg-surface-container text-muted-foreground"
        : "bg-warning-container text-foreground";
  const label = severity === "critical" ? "Critical" : severity === "info" ? "Informational" : "Attention";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const tone =
    status === "resolved"
      ? "bg-success-container text-success"
      : status === "acknowledged"
        ? "bg-warning-container text-foreground"
        : "bg-surface-container text-muted-foreground";
  const label = status === "resolved" ? "Resolved" : status === "acknowledged" ? "Acknowledged" : "Open";
  return <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}
