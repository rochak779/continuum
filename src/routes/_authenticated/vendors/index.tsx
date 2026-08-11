import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { AddVendorModal } from "@/components/app/AddVendorModal";
import { VendorStatusBadge } from "@/components/app/VendorStatusBadge";
import { VendorDocumentsCell } from "@/components/app/VendorDocumentsCell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  buildDashboardSummary,
  describeFailure,
  latestFailureByVendor,
  normalizeAlertSeverity,
} from "@/lib/dashboard-data";

export const Route = createFileRoute("/_authenticated/vendors/")({
  head: () => ({
    meta: [
      { title: "Vendors | Continuum" },
      {
        name: "description",
        content: "Browse and manage every vendor in your Continuum vendor ecosystem.",
      },
      { property: "og:title", content: "Vendors | Continuum" },
      { property: "og:description", content: "Manage your vendor records in Continuum." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VendorsPage,
});

function VendorsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["vendors", "list"],
    queryFn: async () => {
      const [vendorsResult, alertsResult, failuresResult] = await Promise.all([
        supabase.from("vendors").select("*").order("created_at", { ascending: false }),
        supabase
          .from("vendor_monitoring_alerts")
          .select("id, vendor_id, severity, status, attribute_checked, detected_at")
          .neq("status", "resolved"),
        supabase
          .from("vendor_monitoring_failures")
          .select("vendor_id, error_type, message, checked_at")
          .order("checked_at", { ascending: false })
          // Bounds the payload; append-only log can grow unbounded. A vendor's most
          // recent failure could theoretically fall outside this window if the log
          // grows very large, silently dropping its status tooltip — known limitation.
          .limit(500),
      ]);
      if (vendorsResult.error) throw vendorsResult.error;
      if (alertsResult.error) throw alertsResult.error;
      if (failuresResult.error) throw failuresResult.error;
      return {
        vendors: vendorsResult.data,
        alerts: alertsResult.data,
        failures: failuresResult.data,
      };
    },
  });

  const vendors = data?.vendors ?? [];
  const summary = buildDashboardSummary(
    vendors,
    (data?.alerts ?? []).map((alert) => ({ ...alert, severity: normalizeAlertSeverity(alert.severity) })),
  );
  const failureByVendor = latestFailureByVendor(
    (data?.failures ?? []).filter((failure): failure is typeof failure & { vendor_id: string } =>
      Boolean(failure.vendor_id),
    ),
  );

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Vendors</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Vendor
        </Button>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading ? (
          <p className="p-8 text-muted-foreground">Loading vendors…</p>
        ) : !vendors.length ? (
          <p className="p-8 text-muted-foreground">No vendors yet. Add your first vendor.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Country</th>
                <th className="px-6 py-4">Owner</th>
                <th className="px-6 py-4">Risk</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Documents</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="px-6 py-4 font-semibold text-foreground">{v.company_name}</td>
                  <td className="px-6 py-4 text-muted-foreground">{v.category}</td>
                  <td className="px-6 py-4 text-muted-foreground">{v.country}</td>
                  <td className="px-6 py-4 text-muted-foreground">{v.internal_owner}</td>
                  <td className="px-6 py-4 text-muted-foreground">{v.risk_level}</td>
                  <td className="px-6 py-4">
                    <VendorStatusBadge
                      health={summary.healthByVendor.get(v.id) ?? "monitoring_issue"}
                      failureReason={
                        failureByVendor.has(v.id) ? describeFailure(failureByVendor.get(v.id)!) : undefined
                      }
                    />
                  </td>
                  <td className="px-6 py-4">
                    <VendorDocumentsCell vendorId={v.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AddVendorModal isOpen={addOpen} onClose={() => setAddOpen(false)} />
    </AppShell>
  );
}
