import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { SeverityChip, StatusChip } from "./index";
import { supabase } from "@/integrations/supabase/client";
import { alertAttributeLabel } from "@/lib/alert-labels";

export const Route = createFileRoute("/_authenticated/alerts/$alertId")({
  head: () => ({
    meta: [
      { title: "Alert Investigation | Continuum" },
      {
        name: "description",
        content: "Investigate a vendor monitoring alert and record its resolution in Continuum.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: AlertDetailPage,
});

interface AlertDetailRow {
  id: string;
  severity: string;
  status: string;
  attribute_checked: string;
  previous_value: string | null;
  new_value: string | null;
  source: string;
  checked_at: string;
  detected_at: string;
  resolved_at: string | null;
  resolution_type: string | null;
  vendor_id: string;
  vendors: { company_name: string } | null;
}

function vendorName(vendor: AlertDetailRow["vendors"]): string {
  return vendor?.company_name ?? "Unknown vendor";
}

const RESOLUTION_LABELS: Record<string, string> = {
  verified_accepted: "Verified / Accepted",
  false_positive: "False Positive",
  risk_accepted: "Risk Accepted / Exception",
};

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const navigate = useNavigate();

  const {
    data: alert,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["alerts", "detail", alertId],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("vendor_monitoring_alerts")
        .select(
          `id, severity, status, attribute_checked, previous_value, new_value, source,
           checked_at, detected_at, resolved_at, resolution_type, vendor_id,
           vendors ( company_name )`,
        )
        .eq("id", alertId)
        .maybeSingle();
      if (queryError) throw queryError;
      return data as AlertDetailRow | null;
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <button
          type="button"
          onClick={() => navigate({ to: "/alerts" })}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" /> Back to Alerts
        </button>

        {isLoading ? (
          <p className="mt-8 text-muted-foreground">Loading alert…</p>
        ) : error ? (
          <p className="mt-8 text-sm font-medium text-destructive">
            {error instanceof Error ? error.message : "Could not load this alert."}
          </p>
        ) : !alert ? (
          <p className="mt-8 text-muted-foreground">This alert could not be found.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  {alertAttributeLabel(alert.attribute_checked)} change
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{vendorName(alert.vendors)}</p>
              </div>
              <div className="flex items-center gap-2">
                <SeverityChip severity={alert.severity} />
                <StatusChip status={alert.status} />
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                  <h2 className="text-lg font-bold text-foreground">What changed</h2>

                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Vendor" value={vendorName(alert.vendors)} />
                    <Field label="Source" value={alert.source} />
                    <Field label="Attribute" value={alertAttributeLabel(alert.attribute_checked)} />
                    <Field
                      label="Detected"
                      value={new Date(alert.detected_at).toLocaleString()}
                    />
                    <Field label="Previous value" value={alert.previous_value ?? "∅"} />
                    <Field label="New value" value={alert.new_value ?? "∅"} />
                  </dl>
                </div>

                {alert.status === "resolved" && (
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                    <h2 className="text-lg font-bold text-foreground">Resolution history</h2>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Resolution"
                        value={
                          alert.resolution_type
                            ? (RESOLUTION_LABELS[alert.resolution_type] ?? alert.resolution_type)
                            : "—"
                        }
                      />
                      <Field
                        label="Resolved at"
                        value={
                          alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : "—"
                        }
                      />
                    </dl>
                  </div>
                )}
              </div>

              <div>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                  <h2 className="text-lg font-bold text-foreground">Resolution</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {alert.status === "resolved"
                      ? "This alert has already been resolved."
                      : "Resolving alerts from here is being rebuilt against the current schema and isn't available yet."}
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}
