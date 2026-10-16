import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureContinuumProfile } from "@/lib/continuum-profile";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    await ensureContinuumProfile(supabase, data.user);
    return { user: data.user };
  },
  component: () => <Outlet />,
});
