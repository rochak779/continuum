import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, Loader2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import authIllustration from "@/assets/auth-illustration.jpg";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password | Continuum" },
      {
        name: "description",
        content:
          "Set a new password for your Continuum vendor risk and compliance workspace.",
      },
      { property: "og:title", content: "Reset your password | Continuum" },
      {
        property: "og:description",
        content: "Securely set a new password for your Continuum account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResetPasswordPage,
});

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters" })
      .max(72),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

function scorePassword(value: string) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = [
  "bg-destructive",
  "bg-destructive",
  "bg-amber-500",
  "bg-primary/70",
  "bg-primary",
];

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setSessionReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true);
      else {
        const hash = window.location.hash;
        if (!hash.includes("type=recovery") && !hash.includes("access_token")) {
          setError(
            "This reset link is invalid or has expired. Request a new one from the login page.",
          );
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid password");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: parsed.data.password,
      });
      if (updateError) throw updateError;
      setNotice("Password updated. Redirecting to your dashboard…");
      setTimeout(() => navigate({ to: "/dashboard", replace: true }), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const strength = scorePassword(password);

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
              Reset your password
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              Please enter your new password below to regain access to your account.
            </p>

            <form onSubmit={handleSubmit} className="mt-10 space-y-6">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-base font-semibold">
                  New Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Enter new password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 pr-12 text-base"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${STRENGTH_COLOR[strength]}`}
                      style={{ width: `${password ? (strength + 1) * 20 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {password ? STRENGTH_LABEL[strength] : "Strength"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-base font-semibold">
                  Confirm New Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Confirm your new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="h-14 rounded-xl border-border bg-surface-container-lowest px-4 pr-12 text-base"
                  />
                  <button
                    type="button"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              {notice && <p className="text-sm font-medium text-primary">{notice}</p>}

              <Button
                type="submit"
                disabled={loading || !sessionReady}
                className="h-14 w-full rounded-xl bg-primary text-base font-semibold hover:bg-primary/90"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset Password
              </Button>
            </form>

            <div className="mt-6 flex justify-center">
              <Link
                to="/auth"
                className="inline-flex items-center gap-2 text-base font-semibold text-foreground hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Login
              </Link>
            </div>
          </div>
        </div>

        <footer className="text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Continuum Enterprise. All rights reserved.
        </footer>
      </div>

      <aside className="hidden w-1/2 items-center justify-center bg-surface-container-low p-12 lg:flex">
        <img
          src={authIllustration}
          alt="Continuum secure vault illustration"
          width={1024}
          height={768}
          className="w-full max-w-[720px] rounded-2xl shadow-lg"
        />
      </aside>
    </main>
  );
}
