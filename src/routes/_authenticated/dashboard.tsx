import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Store, PlugZap, FileUp, FilePen, X } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

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

function DashboardPage() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [comingSoon, setComingSoon] = useState(false);

  const { data: vendorCount, isLoading } = useQuery({
    queryKey: ["vendors", "count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("vendors")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const showOnboarding = !isLoading && vendorCount === 0 && !dismissed;

  useEffect(() => {
    if (!showOnboarding) setComingSoon(false);
  }, [showOnboarding]);

  return (
    <AppShell>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Overview</h1>
      <p className="mt-2 text-muted-foreground">Monitor your vendor ecosystem performance.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <StatCard label="Total active vendors" value={String(vendorCount ?? 0)} />
        <StatCard label="Pending tasks" value="0" />
        <StatCard label="Recent activity" value="—" />
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
                onClick={() => setDismissed(true)}
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
              <Button variant="outline" onClick={() => setDismissed(true)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-bold text-foreground">{value}</p>
    </div>
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
  badge?: string;
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
