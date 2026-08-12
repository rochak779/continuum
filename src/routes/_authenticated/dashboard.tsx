import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Plus,
  Bell,
  ShieldCheck,
  TrendingDown,
  UserCog,
  Search,
  SlidersHorizontal,
  MoreVertical,
  RefreshCw,
} from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/app/AppShell";
import { AddVendorModal } from "@/components/app/AddVendorModal";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildDashboardSummary,
  buildUpcomingExpiries,
  describeFailure,
  latestFailureByVendor,
  normalizeAlertSeverity,
} from "@/lib/dashboard-data";
import { alertAttributeLabel, describeAlertReason, displayValue } from "@/lib/alert-labels";
import { VendorStatusBadge } from "@/components/app/VendorStatusBadge";
import { VENDOR_HEALTH_LABELS, type VendorHealth } from "@/lib/vendor-health";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Vendor Dashboard | Continuum" },
      {
        name: "description",
        content:
          "Monitor vendor ecosystem performance, alerts and risk distribution inside your Continuum workspace.",
      },
      { property: "og:title", content: "Vendor Dashboard | Continuum" },
      {
        property: "og:description",
        content: "Monitor vendor ecosystem performance and risk in Continuum.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

const HEALTH_COLORS: Record<VendorHealth, string> = {
  healthy: "var(--success)",
  attention_required: "var(--warning)",
  critical: "var(--destructive)",
  monitoring_issue: "var(--muted-foreground)",
};

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function DashboardPage() {
  const [dismissed, setDismissed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "monitoring"],
    queryFn: async () => {
      const [vendorsResult, alertsResult, changesResult, failuresResult, documentsResult] = await Promise.all([
        supabase
          .from("vendors")
          .select("id, company_name, category, risk_level, monitoring_status, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_monitoring_alerts")
          .select(
            "id, vendor_id, severity, status, attribute_checked, previous_value, new_value, detected_at",
          )
          .neq("status", "resolved")
          .order("detected_at", { ascending: false }),
        supabase
          .from("vendor_change_events")
          .select(
            "id, vendor_id, attribute_key, previous_value, new_value, severity, detected_at, snapshot_id",
          )
          .in("severity", ["critical", "attention"])
          .order("detected_at", { ascending: false })
          .limit(5),
        supabase
          .from("vendor_monitoring_failures")
          .select("vendor_id, error_type, message, checked_at")
          .order("checked_at", { ascending: false })
          // Bounds the payload; append-only log can grow unbounded. A vendor's most
          // recent failure could theoretically fall outside this window if the log
          // grows very large, silently dropping its status tooltip — known limitation.
          .limit(500),
        supabase
          .from("vendor_documents")
          .select("id, vendor_id, item_label, file_name, expiry_date")
          .not("expiry_date", "is", null)
          .gte("expiry_date", new Date().toISOString().slice(0, 10))
          .order("expiry_date", { ascending: true })
          .limit(5),
      ]);
      if (vendorsResult.error) throw vendorsResult.error;
      if (alertsResult.error) throw alertsResult.error;
      if (changesResult.error) throw changesResult.error;
      if (failuresResult.error) throw failuresResult.error;
      if (documentsResult.error) throw documentsResult.error;
      return {
        vendors: vendorsResult.data,
        alerts: alertsResult.data,
        changes: changesResult.data,
        failures: failuresResult.data,
        documents: documentsResult.data,
      };
    },
  });

  const vendors = data?.vendors ?? [];
  const alerts = data?.alerts ?? [];
  const changes = data?.changes ?? [];
  const failures = data?.failures ?? [];
  const failureByVendor = latestFailureByVendor(
    failures.filter((failure): failure is typeof failure & { vendor_id: string } =>
      Boolean(failure.vendor_id),
    ),
  );
  const summary = buildDashboardSummary(
    vendors,
    alerts.map((alert) => ({ ...alert, severity: normalizeAlertSeverity(alert.severity) })),
  );
  const showOnboarding =
    manualOpen || (!isLoading && !isError && vendors.length === 0 && !dismissed);
  const metricValue = (value: number) => (isLoading || isError ? "—" : String(value));
  const healthData = (Object.keys(HEALTH_COLORS) as VendorHealth[]).map((health) => ({
    name: VENDOR_HEALTH_LABELS[health],
    value: summary.healthCounts[health],
    color: HEALTH_COLORS[health],
  }));
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.company_name]));
  const documents = data?.documents ?? [];
  const upcomingExpiries = buildUpcomingExpiries(documents, vendorNames);
  const alertsByType = Object.entries(
    alerts.reduce<Record<string, number>>((counts, alert) => {
      const key = alertAttributeLabel(alert.attribute_checked);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  ).map(([type, count]) => ({ type, count }));
  const directory = vendors.slice(0, 5).map((vendor) => ({
    ...vendor,
    category: vendor.category ?? "—",
    risk_level: vendor.risk_level ?? "—",
    health: summary.healthByVendor.get(vendor.id) ?? "monitoring_issue",
  }));
  const actionable = alerts.slice(0, 5).map((alert) => ({
    id: alert.id,
    task: `Review ${alertAttributeLabel(alert.attribute_checked)} change`,
    reason: describeAlertReason(alert),
    vendor: vendorNames.get(alert.vendor_id) ?? "Unknown vendor",
    priority: alert.severity === "critical" ? "High" : "Medium",
    due: "Open",
    overdue: false,
    action: "Review",
  }));

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's what requires your attention today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh dashboard data"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            onClick={() => {
              setDismissed(false);
              setManualOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Vendors
          </Button>
          <button
            type="button"
            aria-label="Notifications"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground"
          >
            <Bell className="h-5 w-5" />
            {!isLoading && summary.openAlerts > 0 && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
            )}
          </button>
        </div>
      </div>

      {isError && (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-error-container px-4 py-3 text-sm text-on-error-container">
          Dashboard data could not be loaded.{" "}
          {error instanceof Error ? error.message : "Try again."}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Total vendors"
          value={metricValue(summary.totalVendors)}
          accent="var(--primary)"
          badge
        />
        <MetricCard
          label="Healthy"
          value={metricValue(summary.healthCounts.healthy)}
          accent="var(--success)"
        />
        <MetricCard
          label="Attention Required"
          value={metricValue(summary.healthCounts.attention_required)}
          accent="var(--warning)"
        />
        <MetricCard
          label="Critical"
          value={metricValue(summary.healthCounts.critical)}
          accent="var(--destructive)"
          valueClass="text-foreground"
        />
        <MetricCard label="Open alerts" value={metricValue(summary.openAlerts)} />
        <MetricCard
          label="Attention Alerts"
          value={metricValue(summary.attentionAlerts)}
          accent="var(--warning)"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Vendor Health Overview">
          {isLoading ? (
            <PanelState>Loading vendor health…</PanelState>
          ) : vendors.length === 0 ? (
            <PanelState>No vendor health data yet.</PanelState>
          ) : (
            <>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={healthData}
                      dataKey="value"
                      innerRadius={70}
                      outerRadius={100}
                      paddingAngle={1}
                      stroke="none"
                    >
                      {healthData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex items-center justify-center gap-6 text-xs text-muted-foreground">
                {healthData.map((d) => (
                  <span key={d.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                    {d.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel title="Alerts by Type">
          {isLoading ? (
            <PanelState>Loading alerts…</PanelState>
          ) : alertsByType.length === 0 ? (
            <PanelState>No open alerts.</PanelState>
          ) : (
            <div className="h-[290px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={alertsByType} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="type"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <Bar
                    dataKey="count"
                    fill="var(--primary-container)"
                    barSize={16}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Upcoming Reviews & Expiries" action={{ label: "View All", to: "/expiries" }}>
          {isLoading ? (
            <PanelState>Loading upcoming expiries…</PanelState>
          ) : upcomingExpiries.length === 0 ? (
            <PanelState>No upcoming reviews or expiries.</PanelState>
          ) : (
            <div className="space-y-4">
              {upcomingExpiries.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{row.companyName}</p>
                    <p className="truncate text-sm text-muted-foreground">{row.item}</p>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {new Date(`${row.expiryDate}T00:00:00`).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent Material Changes" action={{ label: "View All", to: "/changes" }}>
          {isLoading ? (
            <PanelState>Loading recent changes…</PanelState>
          ) : changes.length === 0 ? (
            <PanelState>No material changes detected.</PanelState>
          ) : (
            <div className="space-y-5">
              {changes.map((change) => {
                const Icon = change.severity === "critical" ? TrendingDown : UserCog;
                return (
                  <div key={change.id} className="flex gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">
                          {vendorNames.get(change.vendor_id) ?? "Unknown vendor"}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {alertAttributeLabel(change.attribute_key)} changed
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {displayValue(change.previous_value)} → {displayValue(change.new_value)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(change.detected_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Actions Requiring Attention" action={{ label: "View All Tasks", to: "/alerts" }}>
          {isLoading ? (
            <PanelState>Loading open alerts…</PanelState>
          ) : actionable.length === 0 ? (
            <PanelState>No actions require attention.</PanelState>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">Task</th>
                  <th className="pb-3 font-medium">Vendor</th>
                  <th className="pb-3 font-medium">Priority</th>
                  <th className="pb-3 font-medium">Due date</th>
                  <th className="pb-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {actionable.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-4 text-foreground">
                      <p>{t.task}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t.reason}</p>
                    </td>
                    <td className="py-4 font-semibold text-foreground">{t.vendor}</td>
                    <td className="py-4">
                      <PriorityChip priority={t.priority} />
                    </td>
                    <td
                      className={`py-4 ${t.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                    >
                      {t.due}
                    </td>
                    <td className="py-4 text-right">
                      <button
                        type="button"
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        {t.action}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-foreground">Vendor Directory</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search vendors..." className="h-10 w-[240px] pl-9" />
              </div>
              <button
                type="button"
                aria-label="Filter vendors"
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted-foreground"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isLoading ? (
            <PanelState>Loading vendors…</PanelState>
          ) : directory.length === 0 ? (
            <PanelState>No vendors yet. Add your first vendor to begin monitoring.</PanelState>
          ) : (
            <table className="mt-5 w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">Vendor name</th>
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium">Risk level</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {directory.map((v) => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="py-4">
                      <span className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-[11px] font-bold text-primary">
                          {initials(v.company_name)}
                        </span>
                        <span className="font-semibold text-foreground">{v.company_name}</span>
                      </span>
                    </td>
                    <td className="py-4 text-muted-foreground">{v.category}</td>
                    <td className="py-4">
                      <RiskChip risk={v.risk_level} />
                    </td>
                    <td className="py-4">
                      <VendorStatusBadge
                        health={v.health}
                        failureReason={
                          failureByVendor.has(v.id)
                            ? describeFailure(failureByVendor.get(v.id)!)
                            : undefined
                        }
                      />
                    </td>
                    <td className="py-4 text-right">
                      <MoreVertical className="ml-auto h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 text-center">
            <Link to="/vendors" className="text-sm font-semibold text-primary hover:underline">
              View All Vendors
            </Link>
          </div>
        </div>
      </div>

      {showOnboarding && (
        <AddVendorModal
          isOpen={showOnboarding}
          onClose={() => {
            setDismissed(true);
            setManualOpen(false);
          }}
        />
      )}
    </AppShell>
  );
}

function MetricCard({
  label,
  value,
  accent,
  badge,
  valueClass,
}: {
  label: string;
  value: string;
  accent?: string;
  badge?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {accent && <div className="h-1 w-full" style={{ background: accent }} />}
      <div className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={`mt-2 flex items-center gap-2 text-3xl font-bold ${valueClass ?? "text-foreground"}`}
        >
          {value}
          {badge && <ShieldCheck className="h-4 w-4 text-primary" />}
        </p>
      </div>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: { label: string; to: "/alerts" | "/changes" | "/expiries" };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {action && (
          <Link to={action.to} className="text-sm font-semibold text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function PanelState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-xl bg-surface-container-low px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const tone =
    priority === "High"
      ? "bg-error-container text-on-error-container"
      : priority === "Medium"
        ? "bg-warning-container text-foreground"
        : "bg-surface-container text-muted-foreground";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{priority}</span>;
}

function RiskChip({ risk }: { risk: string }) {
  const key = risk.toLowerCase();
  const tone =
    key === "critical" || key === "high"
      ? "bg-error-container text-on-error-container"
      : key === "medium"
        ? "bg-warning-container text-foreground"
        : "bg-success-container text-success";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {risk}
    </span>
  );
}

function OptionCard({
  icon,
  title,
  description,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 text-left shadow-card transition-shadow hover:shadow-elevated"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
        {icon}
      </span>
      <h3 className="mt-6 text-xl font-bold text-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      {badge && (
        <span className="mt-4 inline-flex w-fit rounded-full bg-warning-container px-3 py-1 text-xs font-semibold text-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
