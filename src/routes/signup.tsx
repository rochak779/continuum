import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Loader2,
  Eye,
  EyeOff,
  User,
  Mail,
  Building2,
  UserPlus,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepRail } from "@/components/signup/StepRail";
import {
  COMPANY_SIZES,
  COUNTRIES,
  DESIGNATIONS,
  DIAL_CODES,
  INDUSTRIES,
  ROLES,
  detailsSchema,
  emptyDetails,
  emptyOrganization,
  inviteSchema,
  organizationSchema,
  type DetailsData,
  type InviteRow,
  type OrganizationData,
} from "@/components/signup/wizard";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your Continuum account | Vendor Risk Monitoring" },
      {
        name: "description",
        content:
          "Set up your organisation, personal details and team in four steps, then create your Continuum vendor risk workspace.",
      },
      { property: "og:title", content: "Create your Continuum account" },
      {
        property: "og:description",
        content:
          "Four-step onboarding to launch your Continuum vendor risk and compliance workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignupPage,
});

function newInvite(): InviteRow {
  return { id: crypto.randomUUID(), email: "", role: "Member" };
}

function SignupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState<OrganizationData>(emptyOrganization);
  const [details, setDetails] = useState<DetailsData>(emptyDetails);
  const [invites, setInvites] = useState<InviteRow[]>([newInvite(), newInvite()]);
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

  const filledInvites = invites.filter((i) => i.email.trim().length > 0);

  function goTo(next: number) {
    setError(null);
    setStep(next);
  }

  function handleContinue() {
    setError(null);
    if (step === 0) {
      const parsed = organizationSchema.safeParse(org);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Please check your details");
        return;
      }
    }
    if (step === 1) {
      const parsed = detailsSchema.safeParse(details);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Please check your details");
        return;
      }
    }
    if (step === 2) {
      for (const invite of filledInvites) {
        const parsed = inviteSchema.safeParse(invite);
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check the invite emails");
          return;
        }
      }
    }
    setStep((s) => Math.min(s + 1, 3));
  }

  async function handleCreateAccount() {
    setError(null);
    setNotice(null);

    const orgParsed = organizationSchema.safeParse(org);
    if (!orgParsed.success) {
      setError("Organisation details are incomplete");
      setStep(0);
      return;
    }
    const detailsParsed = detailsSchema.safeParse(details);
    if (!detailsParsed.success) {
      setError("Your details are incomplete");
      setStep(1);
      return;
    }

    const phone = detailsParsed.data.phone.trim()
      ? `${detailsParsed.data.dialCode} ${detailsParsed.data.phone.trim()}`
      : "";

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: detailsParsed.data.email,
        password: detailsParsed.data.password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: detailsParsed.data.fullName,
            organization_name: orgParsed.data.organizationName,
            country: orgParsed.data.country,
            industry: orgParsed.data.industry,
            company_size: orgParsed.data.companySize,
            phone,
            designation: detailsParsed.data.designation,
            team_invites: filledInvites.map((i) => ({
              email: i.email.trim(),
              role: i.role,
            })),
          },
        },
      });
      if (signUpError) throw signUpError;

      if (data.session && filledInvites.length > 0 && data.user) {
        await supabase.from("team_invites").insert(
          filledInvites.map((i) => ({
            inviter_id: data.user!.id,
            email: i.email.trim(),
            role: i.role,
          })),
        );
      }

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
    <main className="flex min-h-screen bg-background">
      <aside className="hidden w-[32%] flex-col justify-between border-r border-border bg-surface-container-lowest px-10 py-8 lg:flex">
        <Link to="/" className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" strokeWidth={2.2} />
          <span className="text-xl font-bold tracking-tight text-foreground">
            Continuum
          </span>
        </Link>

        <StepRail current={step} />

        <p className="text-sm text-muted-foreground">
          Need help?{" "}
          <a href="#" className="font-semibold text-primary hover:underline">
            Contact Support
          </a>
        </p>
      </aside>

      <section className="flex w-full flex-col px-6 py-10 lg:w-[68%] lg:px-16">
        <div className="mx-auto w-full max-w-[820px] flex-1">
          <p className="mb-6 text-sm font-semibold uppercase tracking-wide text-primary lg:hidden">
            Step {step + 1} of 4
          </p>

          {step === 0 && (
            <StepOrganization value={org} onChange={setOrg} />
          )}
          {step === 1 && (
            <StepDetails
              value={details}
              onChange={setDetails}
              showPassword={showPassword}
              onTogglePassword={() => setShowPassword((v) => !v)}
            />
          )}
          {step === 2 && (
            <StepInvites value={invites} onChange={setInvites} />
          )}
          {step === 3 && (
            <StepReview
              org={org}
              details={details}
              invites={filledInvites}
              onEdit={goTo}
            />
          )}

          {error && (
            <p className="mt-5 text-sm font-medium text-destructive">{error}</p>
          )}
          {notice && (
            <p className="mt-5 text-sm font-medium text-primary">{notice}</p>
          )}

          <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo(step - 1)}
                className="h-12 gap-2 rounded-xl px-4 text-base font-medium"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            ) : (
              <Link
                to="/auth"
                className="text-base text-muted-foreground hover:text-primary"
              >
                Already have an account?{" "}
                <span className="font-semibold text-primary">Log in</span>
              </Link>
            )}

            {step < 3 ? (
              <Button
                type="button"
                onClick={handleContinue}
                className="h-12 gap-2 rounded-xl bg-primary px-6 text-base font-semibold hover:bg-primary/90"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                disabled={loading}
                onClick={handleCreateAccount}
                className="h-12 gap-2 rounded-xl bg-primary px-6 text-base font-semibold hover:bg-primary/90"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Account
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
        {title}
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">{subtitle}</p>
    </header>
  );
}

function FieldSelect({
  label,
  placeholder,
  options,
  value,
  onValueChange,
}: {
  label: string;
  placeholder: string;
  options: readonly string[];
  value: string;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-12 rounded-lg border-border bg-surface-container-lowest px-4 text-base">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StepOrganization({
  value,
  onChange,
}: {
  value: OrganizationData;
  onChange: (v: OrganizationData) => void;
}) {
  const set = (patch: Partial<OrganizationData>) => onChange({ ...value, ...patch });
  return (
    <>
      <PageHeading
        title="Let's get to know your organization"
        subtitle="This helps us personalize your Continuum experience."
      />
      <div className="rounded-2xl border border-border bg-surface-container-lowest p-8 shadow-sm">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="organizationName" className="text-sm font-medium">
              Organization Name
            </Label>
            <Input
              id="organizationName"
              placeholder="Enter organization name"
              value={value.organizationName}
              onChange={(e) => set({ organizationName: e.target.value })}
              className="h-12 rounded-lg border-border bg-surface-container-lowest px-4 text-base"
            />
          </div>
          <FieldSelect
            label="Country"
            placeholder="Select country"
            options={COUNTRIES}
            value={value.country}
            onValueChange={(v) => set({ country: v })}
          />
          <FieldSelect
            label="Industry"
            placeholder="Select industry"
            options={INDUSTRIES}
            value={value.industry}
            onValueChange={(v) => set({ industry: v })}
          />
          <FieldSelect
            label="Company Size"
            placeholder="Select company size"
            options={COMPANY_SIZES}
            value={value.companySize}
            onValueChange={(v) => set({ companySize: v })}
          />
          <FieldSelect
            label="Primary Currency"
            placeholder="Select currency"
            options={CURRENCIES}
            value={value.primaryCurrency}
            onValueChange={(v) => set({ primaryCurrency: v })}
          />
          <FieldSelect
            label="Time Zone"
            placeholder="Select time zone"
            options={TIME_ZONES}
            value={value.timeZone}
            onValueChange={(v) => set({ timeZone: v })}
          />
        </div>
      </div>
    </>
  );
}

function StepDetails({
  value,
  onChange,
  showPassword,
  onTogglePassword,
}: {
  value: DetailsData;
  onChange: (v: DetailsData) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
}) {
  const set = (patch: Partial<DetailsData>) => onChange({ ...value, ...patch });
  return (
    <>
      <PageHeading
        title="Your Details"
        subtitle="Please provide your personal information to set up your admin profile."
      />
      <div className="space-y-6 rounded-2xl border border-border bg-surface-container-lowest p-8 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="fullName" className="text-sm font-medium">
            Full Name
          </Label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="fullName"
              autoComplete="name"
              placeholder="Jane Doe"
              value={value.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
              className="h-12 rounded-lg border-border bg-surface-container-lowest pl-11 text-base"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email Address
          </Label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="jane@example.com"
              value={value.email}
              onChange={(e) => set({ email: e.target.value })}
              className="h-12 rounded-lg border-border bg-surface-container-lowest pl-11 text-base"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              value={value.password}
              onChange={(e) => set({ password: e.target.value })}
              className="h-12 rounded-lg border-border bg-surface-container-lowest px-4 pr-12 text-base"
            />
            <button
              type="button"
              onClick={onTogglePassword}
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

        <div className="space-y-2">
          <Label htmlFor="phone" className="text-sm font-medium">
            Phone Number
          </Label>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-container-lowest pl-2">
            <Select
              value={value.dialCode}
              onValueChange={(v) => set({ dialCode: v })}
            >
              <SelectTrigger className="h-11 w-[92px] border-0 bg-transparent text-base shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAL_CODES.map((c) => (
                  <SelectItem key={c.code} value={c.dial}>
                    {c.code} {c.dial}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 987-6543"
              value={value.phone}
              onChange={(e) => set({ phone: e.target.value })}
              className="h-11 flex-1 border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
            />
          </div>
        </div>

        <FieldSelect
          label="Designation"
          placeholder="Select a role"
          options={DESIGNATIONS}
          value={value.designation}
          onValueChange={(v) => set({ designation: v })}
        />
      </div>
    </>
  );
}

function StepInvites({
  value,
  onChange,
}: {
  value: InviteRow[];
  onChange: (v: InviteRow[]) => void;
}) {
  return (
    <>
      <PageHeading
        title="Invite your team"
        subtitle="Add members to collaborate on your workspace. You can assign roles later."
      />
      <div className="space-y-4 rounded-2xl border border-border bg-surface-container-lowest p-8 shadow-sm">
        {value.map((invite) => (
          <div key={invite.id} className="flex items-center gap-3">
            <div className="relative flex-1">
              <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                aria-label="Colleague email"
                placeholder="colleague@company.com"
                value={invite.email}
                onChange={(e) =>
                  onChange(
                    value.map((row) =>
                      row.id === invite.id ? { ...row, email: e.target.value } : row,
                    ),
                  )
                }
                className="h-12 rounded-lg border-border bg-surface-container-lowest pl-11 text-base"
              />
            </div>
            <Select
              value={invite.role}
              onValueChange={(role) =>
                onChange(
                  value.map((row) => (row.id === invite.id ? { ...row, role } : row)),
                )
              }
            >
              <SelectTrigger className="h-12 w-[190px] rounded-lg border-border bg-surface-container-lowest text-base">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              aria-label="Remove member"
              onClick={() => onChange(value.filter((row) => row.id !== invite.id))}
              className="p-2 text-muted-foreground hover:text-destructive"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => onChange([...value, newInvite()])}
          className="flex items-center gap-2 text-base font-medium text-primary hover:underline"
        >
          <Plus className="h-4 w-4" />
          Add another member
        </button>
      </div>
    </>
  );
}

function SummaryCard({
  icon,
  title,
  onEdit,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-container-lowest p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          {icon}
          {title}
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Edit
        </button>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-base text-muted-foreground">{label}:</span>
      <span className="text-base font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}

function StepReview({
  org,
  details,
  invites,
  onEdit,
}: {
  org: OrganizationData;
  details: DetailsData;
  invites: InviteRow[];
  onEdit: (step: number) => void;
}) {
  return (
    <>
      <PageHeading
        title="Review your details"
        subtitle="Please confirm the information below to create your account."
      />
      <div className="grid gap-6 md:grid-cols-2">
        <SummaryCard
          icon={<Building2 className="h-5 w-5 text-primary" />}
          title="Organization Info"
          onEdit={() => onEdit(0)}
        >
          <SummaryRow label="Company Name" value={org.organizationName} />
          <SummaryRow label="Country" value={org.country} />
          <SummaryRow label="Industry" value={org.industry} />
          <SummaryRow label="Size" value={org.companySize} />
          <SummaryRow label="Currency" value={org.primaryCurrency} />
          <SummaryRow label="Time Zone" value={org.timeZone} />
        </SummaryCard>

        <SummaryCard
          icon={<User className="h-5 w-5 text-primary" />}
          title="Personal Details"
          onEdit={() => onEdit(1)}
        >
          <SummaryRow label="Full Name" value={details.fullName} />
          <SummaryRow label="Email" value={details.email} />
          <SummaryRow
            label="Phone"
            value={details.phone ? `${details.dialCode} ${details.phone}` : ""}
          />
          <SummaryRow label="Designation" value={details.designation} />
        </SummaryCard>
      </div>

      <div className="mt-6">
        <SummaryCard
          icon={<UserPlus className="h-5 w-5 text-primary" />}
          title="Team Invites"
          onEdit={() => onEdit(2)}
        >
          {invites.length === 0 ? (
            <p className="text-base text-muted-foreground">
              No team members invited yet.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
                >
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-base text-foreground">
                    {invite.email}
                  </span>
                  <span className="ml-auto text-sm text-muted-foreground">
                    {invite.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SummaryCard>
      </div>
    </>
  );
}
