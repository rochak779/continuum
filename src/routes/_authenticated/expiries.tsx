import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { buildUpcomingExpiries } from "@/lib/dashboard-data";

export const Route = createFileRoute("/_authenticated/expiries")({
  head: () => ({
    meta: [
      { title: "Upcoming Reviews & Expiries | Continuum" },
      {
        name: "description",
        content: "Every upcoming document expiry across your monitored vendors, soonest first.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ExpiriesPage,
});

function ExpiriesPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["expiries", "list"],
    queryFn: async () => {
      const { data: documents, error } = await supabase
        .from("vendor_documents")
        .select("id, vendor_id, item_label, file_name, expiry_date")
        .not("expiry_date", "is", null)
        .gte("expiry_date", new Date().toISOString().slice(0, 10))
        .order("expiry_date", { ascending: true });
      if (error) throw error;

      const vendorIds = [...new Set(documents.map((d) => d.vendor_id))];
      const { data: vendors, error: vendorsError } =
        vendorIds.length === 0
          ? { data: [] as Array<{ id: string; company_name: string }>, error: null }
          : await supabase.from("vendors").select("id, company_name").in("id", vendorIds);
      if (vendorsError) throw vendorsError;

      return { documents, vendors };
    },
  });

  const documents = data?.documents ?? [];
  const vendorIdByDocument = new Map(documents.map((doc) => [doc.id, doc.vendor_id]));
  const vendorNames = new Map((data?.vendors ?? []).map((v) => [v.id, v.company_name]));
  const expiries = buildUpcomingExpiries(documents, vendorNames);

  return (
    <AppShell>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Upcoming Reviews &amp; Expiries
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every document with an upcoming expiry date, soonest first.
        </p>
      </div>

      {isError ? (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-error-container px-4 py-3 text-sm text-on-error-container">
          Upcoming expiries could not be loaded. {error instanceof Error ? error.message : "Try again."}
        </div>
      ) : (
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-card">
        {isLoading ? (
          <p className="text-muted-foreground">Loading upcoming expiries…</p>
        ) : expiries.length === 0 ? (
          <p className="text-muted-foreground">No upcoming reviews or expiries.</p>
        ) : (
          <div className="space-y-4">
            {expiries.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <Link
                    to="/vendors/$vendorId"
                    params={{ vendorId: vendorIdByDocument.get(row.id) ?? "" }}
                    className="truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
                  >
                    {row.companyName}
                  </Link>
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
      </div>
      )}
    </AppShell>
  );
}
