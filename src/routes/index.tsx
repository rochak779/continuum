import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Building2, Compass, Globe, PlayCircle, Umbrella, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { OverviewCard } from "@/components/landing/OverviewCard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Continuum — Continuous Vendor Monitoring & Risk Management" },
      {
        name: "description",
        content:
          "Continuum continuously detects changes and risks across your vendors so procurement and risk teams can act before small issues become big problems.",
      },
      { property: "og:title", content: "Continuum — Continuous Vendor Monitoring" },
      {
        property: "og:description",
        content:
          "Monitor vendor health, compliance and risk in real time. Act on changes before they become incidents.",
      },
    ],
  }),
  component: Index,
});

const logos = [
  { name: "ACME", icon: Building2 },
  { name: "Globex", icon: Globe },
  { name: "Initech", icon: Compass },
  { name: "Umbrella", icon: Umbrella },
  { name: "Soylent", icon: Leaf },
];

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-[1280px] px-4 py-16 md:px-8 md:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-surface-container-low px-3 py-1.5 text-sm font-semibold text-primary">
                <BadgeCheck className="h-4 w-4" />
                Continuous Vendor Trust, Always On
              </span>

              <h1 className="mt-6 text-[32px] font-bold leading-10 tracking-tight md:text-5xl md:leading-[1.15]">
                Continuous monitoring.
                <br />
                Stronger vendor <span className="text-primary-container">trust.</span>
              </h1>

              <p className="mt-5 max-w-xl text-lg leading-7 text-muted-foreground">
                Continuum continuously detects changes and risks in your vendors so you can take
                action before small issues become big problems.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <Button
                  size="lg"
                  className="rounded-lg bg-primary-container px-5 py-2.5 text-base font-medium hover:bg-primary"
                >
                  Get Started
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2 rounded-lg border-border bg-card px-5 py-2.5 text-base font-medium text-secondary-foreground hover:bg-surface-container-low"
                >
                  <PlayCircle className="h-5 w-5" />
                  See How It Works
                </Button>
              </div>
            </div>

            <OverviewCard />
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] border-t border-border px-4 py-14 md:px-8">
          <p className="text-center text-base text-muted-foreground">
            Trusted by procurement and risk teams at
          </p>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
            {logos.map((l) => (
              <li key={l.name} className="flex items-center gap-2 text-outline">
                <l.icon className="h-5 w-5" />
                <span className="text-xl font-semibold tracking-tight">{l.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-4 px-4 py-6 text-sm md:flex-row md:px-8">
          <span className="font-semibold">Continuum</span>
          <span className="text-muted-foreground">
            © 2026 Continuum. All rights reserved.
          </span>
          <div className="flex gap-6 text-muted-foreground">
            <a href="#" className="hover:text-foreground">Privacy Policy</a>
            <a href="#" className="hover:text-foreground">Terms of Service</a>
            <a href="#" className="hover:text-foreground">Contact Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
