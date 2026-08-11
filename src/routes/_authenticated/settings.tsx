import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app/AppShell";
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
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import {
  joinPhoneForStorage,
  profileDetailsSchema,
  profileOrganizationSchema,
  splitStoredPhone,
} from "@/lib/profile-settings";
import {
  COMPANY_SIZES,
  COUNTRIES,
  DESIGNATIONS,
  DIAL_CODES,
  INDUSTRIES,
} from "@/components/signup/wizard";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Account Settings | Continuum" },
      {
        name: "description",
        content: "View and update your Continuum account and organisation details.",
      },
    ],
  }),
  component: SettingsPage,
});

interface SettingsForm {
  fullName: string;
  dialCode: string;
  phone: string;
  designation: string;
  organizationName: string;
  country: string;
  industry: string;
  companySize: string;
}

const emptyForm: SettingsForm = {
  fullName: "",
  dialCode: DIAL_CODES[0].dial,
  phone: "",
  designation: "",
  organizationName: "",
  country: "",
  industry: "",
  companySize: "",
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "profile"],
    queryFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(
          "full_name, phone, designation, organization_name, country, industry, company_size",
        )
        .eq("id", uid)
        .single();
      if (profileError) throw profileError;

      return { email: userData.user?.email ?? "", profile };
    },
  });

  useEffect(() => {
    if (!data) return;
    const { dialCode, phone } = splitStoredPhone(data.profile.phone);
    setForm({
      fullName: data.profile.full_name ?? "",
      dialCode,
      phone,
      designation: data.profile.designation ?? "",
      organizationName: data.profile.organization_name ?? "",
      country: data.profile.country ?? "",
      industry: data.profile.industry ?? "",
      companySize: data.profile.company_size ?? "",
    });
    setEmail(data.email);
  }, [data]);

  const set = (patch: Partial<SettingsForm>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const detailsParsed = profileDetailsSchema.safeParse({
      fullName: form.fullName,
      dialCode: form.dialCode,
      phone: form.phone,
      designation: form.designation,
    });
    if (!detailsParsed.success) {
      setError(detailsParsed.error.issues[0]?.message ?? "Please check your details");
      return;
    }
    const orgParsed = profileOrganizationSchema.safeParse({
      organizationName: form.organizationName,
      country: form.country,
      industry: form.industry,
      companySize: form.companySize,
    });
    if (!orgParsed.success) {
      setError(orgParsed.error.issues[0]?.message ?? "Please check your organisation details");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: detailsParsed.data.fullName,
          phone: joinPhoneForStorage(detailsParsed.data.dialCode, detailsParsed.data.phone),
          designation: detailsParsed.data.designation,
          organization_name: orgParsed.data.organizationName,
          country: orgParsed.data.country,
          industry: orgParsed.data.industry,
          company_size: orgParsed.data.companySize,
        })
        .eq("id", uid);
      if (updateError) throw updateError;

      await queryClient.invalidateQueries({ queryKey: ["settings", "profile"] });
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, "Could not save your changes"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Account Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          View and update the details you gave us when you set up Continuum.
        </p>

        {isLoading && (
          <p className="mt-8 text-sm text-muted-foreground">Loading your details…</p>
        )}
        {isError && (
          <p className="mt-8 text-sm font-medium text-destructive">
            Couldn't load your account details. Try refreshing the page.
          </p>
        )}

        {!isLoading && !isError && (
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-card"
          >
            <h2 className="text-xl font-bold text-foreground">Your Details</h2>

            <div className="mt-6 space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled className="h-12 bg-surface-container-low" />
              <p className="text-xs text-muted-foreground">
                Contact support to change your login email.
              </p>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => set({ fullName: e.target.value })}
                  className="h-12 bg-surface-container-low"
                />
              </div>

              <SelectField
                label="Designation"
                placeholder="Select designation"
                options={DESIGNATIONS}
                value={form.designation}
                onChange={(v) => set({ designation: v })}
              />

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="phone">Phone</Label>
                <div className="flex gap-2">
                  <Select value={form.dialCode} onValueChange={(v) => set({ dialCode: v })}>
                    <SelectTrigger className="h-12 w-28 bg-surface-container-low">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAL_CODES.map((d) => (
                        <SelectItem key={d.code} value={d.dial}>
                          {d.dial}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => set({ phone: e.target.value })}
                    className="h-12 flex-1 bg-surface-container-low"
                  />
                </div>
              </div>
            </div>

            <h2 className="mt-10 border-t border-border pt-8 text-xl font-bold text-foreground">
              Your Organisation
            </h2>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="organizationName">Organisation Name</Label>
                <Input
                  id="organizationName"
                  value={form.organizationName}
                  onChange={(e) => set({ organizationName: e.target.value })}
                  className="h-12 bg-surface-container-low"
                />
              </div>

              <SelectField
                label="Country"
                placeholder="Select country"
                options={COUNTRIES}
                value={form.country}
                onChange={(v) => set({ country: v })}
              />
              <SelectField
                label="Industry"
                placeholder="Select industry"
                options={INDUSTRIES}
                value={form.industry}
                onChange={(v) => set({ industry: v })}
              />
              <SelectField
                label="Company Size"
                placeholder="Select company size"
                options={COMPANY_SIZES}
                value={form.companySize}
                onChange={(v) => set({ companySize: v })}
              />
            </div>

            {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}
            {saved && !error && (
              <p className="mt-6 text-sm font-medium text-success">Saved.</p>
            )}

            <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
              <Button type="submit" disabled={saving} className="px-6">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

function SelectField({
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 w-full bg-surface-container-low">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
