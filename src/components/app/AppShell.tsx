import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutGrid,
  Building2,
  ShieldCheck,
  BarChart3,
  Settings,
  Bell,
  HelpCircle,
  Search,
  LogOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";

const navItems = [
  { label: "Dashboard", icon: LayoutGrid, to: "/dashboard" as const },
  { label: "Vendors", icon: Building2, to: "/vendors" as const },
];

const staticItems = [
  { label: "Risk Assessment", icon: ShieldCheck },
  { label: "Analytics", icon: BarChart3 },
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
      <aside className="hidden w-[280px] shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-6">
          <ShieldCheck className="h-7 w-7 text-primary-foreground" strokeWidth={2.2} />
          <div>
            <p className="text-lg font-bold leading-tight">Enterprise Portal</p>
            <p className="text-xs text-sidebar-foreground/70">Vendor Management</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-4">
          {navItems.map(({ label, icon: Icon, to }) => {
            const active = pathname.startsWith(to);
            return (
              <Link
                key={label}
                to={to}
                className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
          {staticItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent"
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[72px] items-center gap-4 border-b border-border bg-card px-6">
          <div className="relative w-full max-w-[560px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search vendors, documents..."
              className="h-11 rounded-lg border-border bg-background pl-10"
            />
          </div>
          <div className="ml-auto flex items-center gap-4 text-muted-foreground">
            <Bell className="h-5 w-5" />
            <HelpCircle className="h-5 w-5" />
            <div className="h-9 w-9 rounded-full bg-surface-container-high" />
          </div>
        </header>

        <main className="flex-1 p-6 md:p-10">{children}</main>
      </div>
    </div>
  );
}
