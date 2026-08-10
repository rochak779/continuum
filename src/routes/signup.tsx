import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import authIllustration from "@/assets/auth-illustration.jpg";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your Continuum account | Vendor Risk Monitoring" },
      {
        name: "description",
        content:
          "Create a Continuum account to start monitoring vendor risk, compliance evidence and third-party alerts in one workspace.",
      },
      { property: "og:title", content: "Create your Continuum account" },
      {
        property: "og:description",
        content:
          "Sign up for Continuum and begin monitoring vendor risk across your supply chain.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupPage,
});

const signupSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, { message: "Enter your full name" })
    .max(100, { message: "Full name must be under 100 characters" }),
  organizationName: z
    .string()
    .trim()
    .min(1, { message: "Enter your organisation name" })
    .max(120, { message: "Organisation name must be under 120 characters" }),
  email: z
    .string()
    .trim()
    .email({ message: "Enter a valid work email address" })
    .max(255),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters" })
    .max(72),
});

function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = signupSchema.safeParse({
      fullName,
      organizationName,
      email,
      password,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your details");
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: parsed.data.fullName,
            organization_name: parsed.data.organizationName,
          },
        },
      });
      if (signUpError) throw signUpError;
      if (!data.session) {
        setNotice(
          "Account created — check your email to confirm your address, then log in.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-surface-container-lowest">
      <div className="flex w-full flex-col px-6 py-8 md:px-14 lg:w-1/2">
        <Link to="/" className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2.2} />
          <span className="text-lg font-bold tracking-tight text-foreground">
            Continuum
          </span>
        </Link>

        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-[420px] py-12">
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              Start your journey
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              Create an account to begin monitoring your vendor risk.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-base font-medium">
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  autoComplete="name"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="organizationName" className="text-base font-medium">
                  Organisation Name
                </Label>
                <Input
                  id="organizationName"
                  autoComplete="organization"
                  placeholder="Acme Corporation"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-base font-medium">
                  Work Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="jane.doe@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-base font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 pr-12 text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Must be at least 8 characters.
                </p>
              </div>

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              {notice && <p className="text-sm font-medium text-primary">{notice}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="h-14 w-full rounded-xl bg-primary text-base font-semibold hover:bg-primary/90"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Account
              </Button>
            </form>

            <p className="mt-6 text-center text-base text-muted-foreground">
              Already have an account?{" "}
              <Link to="/auth" className="font-semibold text-primary underline">
                Log in
              </Link>
            </p>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5 text-sm">
          <p className="text-muted-foreground">
            © {new Date().getFullYear()} Continuum. All rights reserved.
          </p>
          <nav className="flex flex-wrap gap-6 font-semibold text-foreground">
            <a href="#" className="hover:text-primary">Privacy Policy</a>
            <a href="#" className="hover:text-primary">Terms of Service</a>
          </nav>
        </footer>
      </div>

      <aside className="hidden w-1/2 flex-col items-center justify-center bg-surface-container-low p-12 lg:flex">
        <img
          src={authIllustration}
          alt="Continuum secure vendor ecosystem illustration"
          width={1024}
          height={768}
          className="w-full max-w-[480px] rounded-2xl shadow-lg"
        />
        <h2 className="mt-10 text-3xl font-bold tracking-tight text-foreground">
          Secure Vendor Ecosystem
        </h2>
        <p className="mt-3 max-w-[440px] text-center text-lg text-muted-foreground">
          Monitor, assess, and mitigate risks across your entire supply chain with
          real-time analytics.
        </p>
      </aside>
    </main>
  );
}
