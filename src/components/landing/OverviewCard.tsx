import { AlertCircle, AlertTriangle, CheckCircle2, Users } from "lucide-react";

const stats = [
  {
    label: "Total Vendors",
    value: "1,248",
    icon: Users,
    box: "border-border bg-card",
    tone: "text-primary",
    valueTone: "text-foreground",
  },
  {
    label: "Healthy",
    value: "892",
    icon: CheckCircle2,
    box: "border-success/20 bg-success-container",
    tone: "text-success",
    valueTone: "text-success",
  },
  {
    label: "Attention",
    value: "231",
    icon: AlertTriangle,
    box: "border-primary/20 bg-surface-container-low",
    tone: "text-primary",
    valueTone: "text-primary",
  },
  {
    label: "Critical",
    value: "125",
    icon: AlertCircle,
    box: "border-destructive/20 bg-error-container",
    tone: "text-destructive",
    valueTone: "text-destructive",
  },
];

const alerts = [
  { title: "Company status changed", vendor: "Acme Supplies Ltd", time: "2h ago", icon: AlertCircle, tone: "text-destructive" },
  { title: "Director change detected", vendor: "Globex Inc", time: "5h ago", icon: AlertTriangle, tone: "text-primary" },
  { title: "Insurance certificate expiring", vendor: "Initech Systems", time: "1d ago", icon: AlertTriangle, tone: "text-warning" },
];

const ring = [
  { color: "var(--success)", pct: 42 },
  { color: "var(--primary)", pct: 30 },
  { color: "var(--destructive)", pct: 18 },
  { color: "var(--outline-variant)", pct: 10 },
];

export function OverviewCard() {
  let acc = 0;
  const segments = ring
    .map((s) => {
      const from = acc;
      acc += s.pct;
      return `${s.color} ${from}% ${acc}%`;
    })
    .join(", ");

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-elevated">
      <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
      <div className="mt-4 border-t border-border" />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.box}`}>
            <div className={`flex items-start gap-1.5 ${s.tone}`}>
              <s.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="text-xs font-semibold leading-4">{s.label}</span>
            </div>
            <p className={`mt-2 text-2xl font-bold tracking-tight ${s.valueTone}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1.2fr_1fr] md:divide-x md:divide-border">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Recent Alerts</p>
          <ul className="mt-3 space-y-2">
            {alerts.map((a) => (
              <li
                key={a.title}
                className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2.5"
              >
                <a.icon className={`h-4 w-4 shrink-0 ${a.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.vendor}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{a.time}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:pl-6">
          <p className="text-sm font-medium text-muted-foreground">Vendors by Risk</p>
          <div className="mt-4 flex justify-center">
            <div
              className="grid h-36 w-36 place-items-center rounded-full"
              style={{ background: `conic-gradient(${segments})` }}
            >
              <div className="grid h-[104px] w-[104px] place-items-center rounded-full bg-card text-center">
                <div>
                  <p className="text-lg font-bold leading-tight">72%</p>
                  <p className="text-xs text-muted-foreground">healthy</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
