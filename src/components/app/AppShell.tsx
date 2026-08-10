import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid,
  Users,
  Bell,
  Eye,
  BarChart3,
  Settings,
  ShieldCheck,
  ChevronRight,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { AssistantWidget } from "@/components/app/AssistantWidget";

const navItems = [
  { label: "Dashboard", icon: LayoutGrid, to: "/dashboard" as const },
  { label: "Vendors", icon: Users, to: "/vendors" as const },
  { label: "Alerts", icon: Bell, to: "/alerts" as const },
];

const staticItems = [
  { label: "Monitoring", icon: Eye },
  { label: "Reports", icon: BarChart3 },
  { label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <ShieldCheck className="h-6 w-6 text-sidebar-foreground" strokeWidth={2.2} />
          <p className="text-xl font-bold leading-tight">Continuum</p>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {navItems.map(({ label, icon: Icon, to }) => {
            const active = pathname.startsWith(to);
            return (
              <Link
                key={label}
                to={to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            );
          })}
          {staticItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent"
            >
              <Icon className="h-[18px] w-[18px]" />
              {label}
            </button>
          ))}
        </nav>

        <div className="p-3">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border px-3 py-3 text-left transition-colors hover:bg-sidebar-accent"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-sidebar-foreground/60">Organization</span>
              <span className="block truncate text-sm font-semibold">Acme Corp</span>
            </span>
            <ChevronRight className="h-4 w-4 text-sidebar-foreground/60" />
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>

      <AssistantWidget />
    </div>
  );
}
