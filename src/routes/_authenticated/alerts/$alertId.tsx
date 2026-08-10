import type { SupabaseClient } from "@supabase/supabase-js";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { AlertResolutionPanel } from "@/components/app/AlertResolutionPanel";
import { SeverityChip, StatusChip } from "./index";
import { supabase } from "@/integrations/supabase/client";

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

// `alerts` / `change_events` / `vendors` (its new shape) predate the
// generated Database types — same untyped-client pattern used server-side
// in src/integrations/*/*.server.ts (see docs there for why).
const db = supabase as unknown as SupabaseClient;

interface AlertDetailRow {
  id: string;
  severity: "critical" | "attention" | "info";
  status: "open" | "investigating" | "resolved";
  title: string;
  description: string;
  recommended_action: string;
  created_at: string;
  resolved_at: string | null;
  resolution_type: "verified_accepted" | "false_positive" | "risk_accepted" | null;
  resolution_reason: string | null;
  vendor_id: string;
  vendors: { id: string; display_name: string | null; legal_name: string } | null;
  change_events: {
    id: string;
    attribute_key: string;
    previous_value: unknown;
    new_value: unknown;
    materiality_reason: string;
    provider: string;
    detected_at: string;
  } | null;
}

function vendorName(vendor: AlertDetailRow["vendors"]): string {
  if (!vendor) return "Unknown vendor";
  return vendor.display_name ?? vendor.legal_name;
}

/** previous_value/new_value are jsonb — render plainly if it's already a string, else stringify. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const alertQueryKey = ["alerts", "detail", alertId];
  const {
    data: alert,
    isLoading,
    error,
  } = useQuery({
    queryKey: alertQueryKey,
    queryFn: async () => {
      const { data, error: queryError } = await db
        .from("alerts")
        .select(
          `id, severity, status, title, description, recommended_action, created_at,
           resolved_at, resolution_type, resolution_reason, vendor_id,
           vendors ( id, display_name, legal_name ),
           change_events (
             id, attribute_key, previous_value, new_value, materiality_reason, provider, detected_at
           )`,
        )
        .eq("id", alertId)
        .maybeSingle();
      if (queryError) throw queryError;
      return data as unknown as AlertDetailRow | null;
    },
  });

  async function handleResolved() {
    await queryClient.invalidateQueries({ queryKey: alertQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["alerts", "list"] });
  }

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
                <h1 className="text-3xl font-bold tracking-tight text-foreground">{alert.title}</h1>
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
                    <Field label="Source" value={alert.change_events?.provider ?? "—"} />
                    <Field
                      label="Previous value"
                      value={formatValue(alert.change_events?.previous_value)}
                    />
                    <Field label="New value" value={formatValue(alert.change_events?.new_value)} />
                    <Field
                      label="Detected"
                      value={
                        alert.change_events?.detected_at
                          ? new Date(alert.change_events.detected_at).toLocaleString()
                          : "—"
                      }
                    />
                    <Field label="Attribute" value={alert.change_events?.attribute_key ?? "—"} />
                  </dl>

                  <div className="mt-6 border-t border-border pt-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Materiality reason
                    </h3>
                    <p className="mt-2 text-sm text-foreground">
                      {alert.change_events?.materiality_reason ?? alert.description}
                    </p>
                  </div>

                  <div className="mt-6 border-t border-border pt-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Recommended action
                    </h3>
                    <p className="mt-2 text-sm text-foreground">{alert.recommended_action}</p>
                  </div>
                </div>

                {alert.status === "resolved" && (
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                    <h2 className="text-lg font-bold text-foreground">Resolution history</h2>
                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Resolution" value={alert.resolution_type ?? "—"} />
                      <Field
                        label="Resolved at"
                        value={
                          alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : "—"
                        }
                      />
                    </dl>
                    {alert.resolution_reason && (
                      <p className="mt-4 text-sm text-foreground">{alert.resolution_reason}</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                {user && (
                  <AlertResolutionPanel
                    alertId={alert.id}
                    status={alert.status}
                    actorId={user.id}
                    onResolved={() => void handleResolved()}
                  />
                )}
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
