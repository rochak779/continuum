import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { VendorDocumentsCell } from "@/components/app/VendorDocumentsCell";
import { supabase } from "@/integrations/supabase/client";
import { formatRegisteredOfficeAddress, formatSicCodes } from "@/lib/vendor-detail";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/vendors/$vendorId")({
  head: () => ({
    meta: [
      { title: "Vendor Details | Continuum" },
      {
        name: "description",
        content: "View full vendor details, Companies House data, and documents in Continuum.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: VendorDetailPage,
});

type VendorRow = Tables<"vendors">;
type SnapshotRow = Tables<"vendor_company_snapshots">;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function VendorDetailPage() {
  const { vendorId } = Route.useParams();
  const navigate = useNavigate();

  const {
    data: vendor,
    isLoading: vendorLoading,
    error: vendorError,
  } = useQuery({
    queryKey: ["vendors", "detail", vendorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", vendorId)
        .maybeSingle();
      if (error) throw error;
      return data as VendorRow | null;
    },
  });

  const { data: snapshot, isLoading: snapshotLoading } = useQuery({
    queryKey: ["vendors", "detail", vendorId, "companies-house-snapshot"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendor_company_snapshots")
        .select("*")
        .eq("vendor_id", vendorId)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as SnapshotRow | null;
    },
    enabled: Boolean(vendor),
  });

  const isLoading = vendorLoading || (Boolean(vendor) && snapshotLoading);

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <button
          type="button"
          onClick={() => navigate({ to: "/vendors" })}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" /> Back to Vendors
        </button>

        {isLoading ? (
          <p className="mt-8 text-muted-foreground">Loading vendor…</p>
        ) : vendorError ? (
          <p className="mt-8 text-sm font-medium text-destructive">
            {vendorError instanceof Error ? vendorError.message : "Could not load this vendor."}
          </p>
        ) : !vendor ? (
          <p className="mt-8 text-muted-foreground">This vendor could not be found.</p>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
              {vendor.company_name}
            </h1>

            <div className="mt-6 space-y-6">
              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Vendor info</h2>
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Company name" value={vendor.company_name} />
                  <Field label="Category" value={vendor.category ?? "—"} />
                  <Field label="Country" value={vendor.country ?? "—"} />
                  <Field label="Internal owner" value={vendor.internal_owner ?? "—"} />
                  <Field label="Risk level" value={vendor.risk_level ?? "—"} />
                  <Field label="Email" value={vendor.email ?? "—"} />
                  <Field label="Internal vendor ID" value={vendor.internal_vendor_id ?? "—"} />
                  <Field label="Monitoring status" value={vendor.monitoring_status} />
                  <Field label="Source" value={vendor.source} />
                  <Field label="Created" value={formatDate(vendor.created_at)} />
                </dl>
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Companies House data</h2>
                {!snapshot ? (
                  <p className="mt-4 text-sm text-muted-foreground">No Companies House data yet.</p>
                ) : (
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Company number" value={snapshot.company_number} />
                    <Field label="Company status" value={snapshot.company_status ?? "—"} />
                    <Field label="Company type" value={snapshot.company_type ?? "—"} />
                    <Field label="Date of incorporation" value={formatDate(snapshot.date_of_creation)} />
                    <Field
                      label="Registered office address"
                      value={formatRegisteredOfficeAddress(
                        snapshot.registered_office_address as
                          | {
                              address_line_1?: string;
                              address_line_2?: string;
                              locality?: string;
                              region?: string;
                              postal_code?: string;
                              country?: string;
                              premises?: string;
                              po_box?: string;
                            }
                          | null,
                      )}
                    />
                    <Field label="SIC codes" value={formatSicCodes(snapshot.sic_codes)} />
                    <Field label="Accounts next due" value={formatDate(snapshot.accounts_next_due)} />
                    <Field
                      label="Confirmation statement next due"
                      value={formatDate(snapshot.confirmation_statement_next_due)}
                    />
                  </dl>
                )}
              </div>

              <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
                <h2 className="text-lg font-bold text-foreground">Documents</h2>
                <div className="mt-4">
                  <VendorDocumentsCell vendorId={vendor.id} />
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
      <dd className="mt-1 whitespace-pre-line text-sm text-foreground">{value}</dd>
    </div>
  );
}
