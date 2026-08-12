import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Info, TrendingDown, UserCog } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { alertAttributeLabel, displayValue } from "@/lib/alert-labels";

export const Route = createFileRoute("/_authenticated/changes")({
  head: () => ({
    meta: [
      { title: "Material Changes | Continuum" },
      {
        name: "description",
        content: "Every change detected across your monitored vendors, newest first.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ChangesPage,
});

interface ChangeRow {
  id: string;
  vendor_id: string;
  attribute_key: string;
  previous_value: Json | null;
  new_value: Json | null;
  severity: string;
  detected_at: string;
  vendors: { company_name: string } | null;
}

function vendorName(vendor: ChangeRow["vendors"]): string {
  return vendor?.company_name ?? "Unknown vendor";
}

/** Matches the tone logic used by SeverityChip in alerts/index.tsx. */
function severityTone(severity: string): { badge: string; Icon: typeof TrendingDown } {
  if (severity === "critical") {
    return { badge: "bg-error-container text-on-error-container", Icon: TrendingDown };
  }
  if (severity === "info") {
    return { badge: "bg-surface-container text-muted-foreground", Icon: Info };
  }
  return { badge: "bg-warning-container text-foreground", Icon: UserCog };
}

function ChangesPage() {
  const {
    data: changes,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["changes", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_change_events")
        .select(
          "id, vendor_id, attribute_key, previous_value, new_value, severity, detected_at, vendors ( company_name )",
        )
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ChangeRow[];
    },
  });

  const rows = changes ?? [];

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Material Changes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change detected across your monitored vendors, newest first.
        </p>
      </div>

      {isError ? (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-error-container px-4 py-3 text-sm text-on-error-container">
          Changes could not be loaded. {error instanceof Error ? error.message : "Try again."}
        </div>
      ) : (
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-card">
        {isLoading ? (
          <p className="text-muted-foreground">Loading changes…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">No changes detected yet.</p>
        ) : (
          <div className="space-y-5">
            {rows.map((change) => {
              const { badge, Icon } = severityTone(change.severity);
              return (
                <div key={change.id} className="flex gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${badge}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm text-foreground">
                      <Link
                        to="/vendors/$vendorId"
                        params={{ vendorId: change.vendor_id }}
                        className="font-semibold hover:text-primary hover:underline"
                      >
                        {vendorName(change.vendors)}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        {alertAttributeLabel(change.attribute_key)} changed
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {displayValue(change.previous_value)} →{" "}
                      {displayValue(change.new_value)}
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
      </div>
      )}
    </AppShell>
  );
}
