import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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
  const navigate = useNavigate();
  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Vendors</h1>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link to="/vendors/upload">Upload file</Link>
          </Button>
          <Button onClick={() => navigate({ to: "/vendors/new" })}>
            <Plus className="mr-2 h-4 w-4" /> Add Vendor
          </Button>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {isLoading ? (
          <p className="p-8 text-muted-foreground">Loading vendors…</p>
        ) : !vendors?.length ? (
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
