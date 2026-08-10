import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";

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

// `alerts` and its `vendors` embed predate the generated Database types
// (supabase/migrations/20260810130000) — same untyped-client pattern used
// server-side in src/integrations/*/*.server.ts, applied here for the
// browser client instead.
const db = supabase as unknown as SupabaseClient;

interface AlertListRow {
  id: string;
  severity: "critical" | "attention" | "info";
  status: "open" | "investigating" | "resolved";
  title: string;
  created_at: string;
  vendors: { display_name: string | null; legal_name: string } | null;
}

function vendorName(vendor: AlertListRow["vendors"]): string {
  if (!vendor) return "Unknown vendor";
  return vendor.display_name ?? vendor.legal_name;
}

function AlertsPage() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts", "list"],
    queryFn: async () => {
      const { data, error } = await db
        .from("alerts")
        .select("id, severity, status, title, created_at, vendors ( display_name, legal_name )")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as AlertListRow[];
    },
  });

  const openAlerts = alerts?.filter((a) => a.status !== "resolved") ?? [];
  const resolvedAlerts = alerts?.filter((a) => a.status === "resolved") ?? [];

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vendor monitoring alerts across your organisation, newest first.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading ? (
          <p className="p-8 text-muted-foreground">Loading alerts…</p>
        ) : !alerts?.length ? (
          <p className="p-8 text-muted-foreground">
            No alerts yet. They'll appear here once vendor monitoring detects a material change.
          </p>
        ) : (
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
              {[...openAlerts, ...resolvedAlerts].map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-6 py-4">
                    <Link
                      to="/alerts/$alertId"
                      params={{ alertId: a.id }}
                      className="font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {a.title}
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
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

export function SeverityChip({ severity }: { severity: "critical" | "attention" | "info" }) {
  const tone =
    severity === "critical"
      ? "bg-error-container text-on-error-container"
      : severity === "attention"
        ? "bg-warning-container text-foreground"
        : "bg-surface-container text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {severity === "critical"
        ? "Critical"
        : severity === "attention"
          ? "Attention"
          : "Informational"}
    </span>
  );
}

export function StatusChip({ status }: { status: "open" | "investigating" | "resolved" }) {
  const tone =
    status === "resolved"
      ? "bg-success-container text-success"
      : status === "investigating"
        ? "bg-warning-container text-foreground"
        : "bg-surface-container text-muted-foreground";
  const label =
    status === "resolved" ? "Resolved" : status === "investigating" ? "Investigating" : "Open";
  return <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}
