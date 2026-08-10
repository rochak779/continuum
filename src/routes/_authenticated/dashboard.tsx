import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Plus,
  Bell,
  ShieldCheck,
  TrendingDown,
  UserCog,
  Search,
  SlidersHorizontal,
  MoreVertical,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app/AppShell";
import { AddVendorModal } from "@/components/app/AddVendorModal";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

const healthData = [
  { name: "Healthy", value: 118, color: "var(--success)" },
  { name: "Attention", value: 18, color: "var(--warning)" },
  { name: "Critical", value: 6, color: "var(--destructive)" },
];

const alertsByType = [
  { type: "Financial", count: 8 },
  { type: "Security", count: 5 },
  { type: "Compliance", count: 4 },
  { type: "News", count: 6 },
  { type: "Ops", count: 1 },
];

const upcoming = [
  { initials: "GL", name: "Globex Corporation", detail: "Annual Review", due: "In 5 Days", tone: "muted" },
  { initials: "IN", name: "Initech", detail: "SOC 2 Expiry", due: "Tomorrow", tone: "critical" },
  { initials: "UM", name: "Umbrella Corp", detail: "Insurance Renewal", due: "In 14 Days", tone: "muted" },
] as const;

const materialChanges = [
  {
    icon: TrendingDown,
    vendor: "Acme Supplies Ltd",
    headline: "Status changed to Critical",
    detail: "Financial health score dropped significantly in Q3.",
    time: "2 hours ago",
  },
  {
    icon: UserCog,
    vendor: "Beta Logistics",
    headline: "Director change detected",
    detail: "CEO John Doe stepped down unexpectedly.",
    time: "5 hours ago",
  },
];

const tasks = [
  { task: "Review Financial Alert", vendor: "Acme Supplies Ltd", priority: "High", due: "Overdue", overdue: true, action: "Review" },
  { task: "Request new SOC 2 report", vendor: "Initech", priority: "Medium", due: "Tomorrow", overdue: false, action: "Send Request" },
  { task: "Acknowledge Leadership Change", vendor: "Beta Logistics", priority: "Low", due: "Oct 25, 2023", overdue: false, action: "Acknowledge" },
];

const sampleVendors = [
  { company_name: "Acme Supplies Ltd", category: "Hardware", risk_level: "Critical", status: "Active" },
  { company_name: "Soylent Corp", category: "Food Services", risk_level: "Low", status: "Active" },
  { company_name: "Initech", category: "Software", risk_level: "Medium", status: "Review Pending" },
  { company_name: "Globex Corporation", category: "Logistics", risk_level: "Low", status: "Active" },
];

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

function DashboardPage() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("id, company_name, category, risk_level")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const vendorCount = vendors?.length ?? 0;
  const showOnboarding =
    manualOpen || (!isLoading && vendorCount === 0 && !dismissed);
  const directory = vendorCount
    ? vendors!.slice(0, 5).map((v) => ({
        company_name: v.company_name,
        category: v.category ?? "—",
        risk_level: v.risk_level ?? "Low",
        status: "Active",
      }))
    : sampleVendors;

  useEffect(() => {
    if (!showOnboarding) setComingSoon(false);
  }, [showOnboarding]);

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
          <Button onClick={() => { setDismissed(false); setManualOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Vendors
          </Button>
          <button
            type="button"
            aria-label="Notifications"
            className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Total vendors" value={String(vendorCount || 142)} accent="var(--primary)" badge />
        <MetricCard label="Healthy" value="118" accent="var(--success)" />
        <MetricCard label="Attention" value="18" accent="var(--warning)" />
        <MetricCard label="Critical" value="6" accent="var(--destructive)" valueClass="text-foreground" />
        <MetricCard label="Open alerts" value="24" />
        <MetricCard label="Overdue actions" value="3" valueClass="text-destructive" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Vendor Health Overview">
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
        </Panel>

        <Panel title="Alerts by Type">
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
                <Bar dataKey="count" fill="var(--primary-container)" barSize={16} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Upcoming Reviews & Expiries" action="View All">
          <div className="space-y-3">
            {upcoming.map((u) => (
              <div
                key={u.name}
                className="flex items-center gap-3 rounded-xl bg-surface-container-low px-3 py-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-xs font-bold text-primary">
                  {u.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.detail}</p>
                </div>
                <span
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    u.tone === "critical"
                      ? "bg-error-container text-on-error-container"
                      : "text-muted-foreground"
                  }`}
                >
                  {u.due}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent Material Changes" action="View All">
          <div className="space-y-5">
            {materialChanges.map(({ icon: Icon, ...c }) => (
              <div key={c.vendor} className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">{c.vendor}</span>{" "}
                    <span className="text-muted-foreground">{c.headline}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{c.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Actions Requiring Attention" action="View All Tasks">
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
              {tasks.map((t) => (
                <tr key={t.task} className="border-t border-border">
                  <td className="py-4 text-foreground">{t.task}</td>
                  <td className="py-4 font-semibold text-foreground">{t.vendor}</td>
                  <td className="py-4">
                    <PriorityChip priority={t.priority} />
                  </td>
                  <td className={`py-4 ${t.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    {t.due}
                  </td>
                  <td className="py-4 text-right">
                    <button type="button" className="text-sm font-semibold text-primary hover:underline">
                      {t.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <tr key={v.company_name} className="border-t border-border">
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
                  <td className="py-4 text-muted-foreground">{v.status}</td>
                  <td className="py-4 text-right">
                    <MoreVertical className="ml-auto h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 text-center">
            <Link to="/vendors" className="text-sm font-semibold text-primary hover:underline">
              View All Vendors
            </Link>
          </div>
        </div>
      </div>

      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-[1120px] overflow-hidden rounded-2xl bg-card shadow-elevated">
            <div className="flex items-start gap-4 border-b border-border px-8 py-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary">
                <Store className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  Add your vendors
                </h2>
                <p className="mt-1 text-muted-foreground">
                  Choose how you'd like to import vendor data into Continuum.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setDismissed(true); setManualOpen(false); }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-6 bg-background px-8 py-8 md:grid-cols-3">
              <OptionCard
                icon={<PlugZap className="h-6 w-6" />}
                title="Connect your ERP"
                description="Sync automatically with SAP, Oracle, NetSuite, and other major enterprise systems."
                badge={comingSoon ? "Coming soon" : undefined}
                onClick={() => setComingSoon(true)}
              />
              <OptionCard
                icon={<FileUp className="h-6 w-6" />}
                title="Add vendors by uploading a file"
                description="Import via CSV or Excel. Download our template for seamless mapping."
                onClick={() => navigate({ to: "/vendors/upload" })}
              />
              <OptionCard
                icon={<FilePen className="h-6 w-6" />}
                title="Add vendors manually"
                description="Enter details one by one using our structured intake form for strict data control."
                onClick={() => navigate({ to: "/vendors/new" })}
              />
            </div>

            <div className="flex items-center justify-between border-t border-border px-8 py-5">
              <p className="text-sm text-muted-foreground">
                Need help?{" "}
                <a href="#" className="font-medium text-primary hover:underline">
                  View import documentation
                </a>
              </p>
              <Button variant="outline" onClick={() => { setDismissed(true); setManualOpen(false); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
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
        <p className={`mt-2 flex items-center gap-2 text-3xl font-bold ${valueClass ?? "text-foreground"}`}>
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
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {action && (
          <button type="button" className="text-sm font-semibold text-primary hover:underline">
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
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
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
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
