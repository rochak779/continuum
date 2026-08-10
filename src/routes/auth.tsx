import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import authIllustration from "@/assets/auth-illustration.jpg";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in to Continuum | Vendor Risk Management" },
      {
        name: "description",
        content:
          "Sign in to Continuum to manage vendor onboarding, risk reviews and compliance evidence in one workspace.",
      },
      { property: "og:title", content: "Sign in to Continuum" },
      {
        property: "og:description",
        content:
          "Secure access to your Continuum vendor risk and compliance workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const credentialsSchema = z.object({
  email: z.string().trim().email({ message: "Enter a valid email address" }).max(255),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .max(72),
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
      if (signInError) throw signInError;

    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setError(null);
    setNotice(null);
    const parsedEmail = z.string().trim().email().safeParse(email);
    if (!parsedEmail.success) {
      setError("Enter your email address first, then select Forgot password.");
      return;
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      parsedEmail.data,
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    if (resetError) setError(resetError.message);
    else setNotice("Password reset link sent — check your inbox.");
  }

  return (
    <main className="flex min-h-screen bg-surface-container-lowest">
      <div className="flex w-full flex-col px-6 py-8 md:px-14 lg:w-1/2">
        <Link to="/" className="flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" strokeWidth={2.2} />
          <span className="text-2xl font-bold tracking-tight text-foreground">
            Continuum
          </span>
        </Link>

        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-[420px] py-12">
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              Welcome back
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              Sign in to continue to your account
            </p>

            <form onSubmit={handleSubmit} className="mt-10 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-base font-semibold">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-base font-semibold">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 pr-40 text-base"
                  />
                  {true && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
              </div>

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              {notice && <p className="text-sm font-medium text-primary">{notice}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="h-14 w-full rounded-xl bg-primary text-base font-semibold hover:bg-primary/90"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </form>

            <p className="mt-8 text-center text-base text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/signup" className="font-semibold text-primary hover:underline">
                Sign up
              </Link>

            </p>
          </div>
        </div>

        <footer className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            © {new Date().getFullYear()} Continuum. All rights reserved.
          </p>
          <nav className="flex flex-wrap gap-6 font-semibold text-foreground">
            <a href="#" className="hover:text-primary">Privacy Policy</a>
            <a href="#" className="hover:text-primary">Terms of Service</a>
            <a href="#" className="hover:text-primary">Contact Support</a>
          </nav>
        </footer>
      </div>

      <aside className="hidden w-1/2 items-center justify-center bg-surface-container-low p-12 lg:flex">
        <img
          src={authIllustration}
          alt="Continuum security dashboard illustration"
          width={1024}
          height={768}
          className="w-full max-w-[720px] rounded-2xl shadow-lg"
        />
      </aside>
    </main>
  );
}
