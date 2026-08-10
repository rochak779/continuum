import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Mail, Hash, User } from "lucide-react";
import { z } from "zod";

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
import { RISK_LEVELS, VENDOR_CATEGORIES, VENDOR_COUNTRIES } from "@/lib/vendor-options";

export const Route = createFileRoute("/_authenticated/vendors/new")({
  head: () => ({
    meta: [
      { title: "Add Vendor Manually | Continuum" },
      {
        name: "description",
        content:
          "Create a vendor profile manually with company, category, ownership and risk details in Continuum.",
      },
      { property: "og:title", content: "Add Vendor Manually | Continuum" },
      {
        property: "og:description",
        content: "Create a structured vendor profile in Continuum.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AddVendorManuallyPage,
});

const vendorSchema = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(120),
  country: z.string().min(1, "Select a country"),
  category: z.string().min(1, "Select a category"),
  internal_owner: z.string().trim().min(2, "Internal vendor owner is required").max(120),
  risk_level: z.string().min(1, "Select a risk level"),
  email: z.string().trim().email("Enter a valid vendor email").max(255),
  internal_vendor_id: z.string().trim().max(60),
});

function AddVendorManuallyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    company_name: "",
    country: "",
    category: "",
    internal_owner: "",
    risk_level: "",
    email: "",
    internal_vendor_id: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = vendorSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");
      const { error: insertError } = await supabase
        .from("vendors")
        .insert({ ...parsed.data, owner_id: uid, source: "manual" });
      if (insertError) throw insertError;
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      navigate({ to: "/vendors" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the vendor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" /> Back
          </button>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Add Vendor Manually
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-card"
        >
          <div className="space-y-2">
            <Label htmlFor="company">
              Company Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="company"
              value={form.company_name}
              onChange={(e) => set({ company_name: e.target.value })}
              className="h-12 bg-surface-container-low"
            />
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <SelectField
              label="Country of Registration"
              placeholder="Select country"
              options={VENDOR_COUNTRIES}
              value={form.country}
              onChange={(v) => set({ country: v })}
            />
            <SelectField
              label="Vendor Category"
              placeholder="Select category"
              options={VENDOR_CATEGORIES}
              value={form.category}
              onChange={(v) => set({ category: v })}
            />

            <div className="space-y-2">
              <Label htmlFor="owner">
                Internal Vendor Owner <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="owner"
                  placeholder="Search employees..."
                  value={form.internal_owner}
                  onChange={(e) => set({ internal_owner: e.target.value })}
                  className="h-12 bg-surface-container-low pl-10"
                />
              </div>
            </div>

            <SelectField
              label="Initial Risk Level Assessment"
              placeholder="Select risk level"
              options={RISK_LEVELS}
              value={form.risk_level}
              onChange={(v) => set({ risk_level: v })}
            />
          </div>

          <h2 className="mt-10 border-t border-border pt-8 text-xl font-bold text-foreground">
            Contact Information
          </h2>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">
                Vendor Email <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="contact@vendor.com"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  className="h-12 bg-surface-container-low pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vid">
                Internal Vendor ID{" "}
                <span className="font-normal text-muted-foreground">(Optional)</span>
              </Label>
              <div className="relative">
                <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="vid"
                  placeholder="e.g. V-10293"
                  value={form.internal_vendor_id}
                  onChange={(e) => set({ internal_vendor_id: e.target.value })}
                  className="h-12 bg-surface-container-low pl-10"
                />
              </div>
            </div>
          </div>

          {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}

          <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
            <Button type="button" variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="px-6">
              <Plus className="mr-2 h-4 w-4" /> Add Vendor
            </Button>
          </div>
        </form>
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
      <Label>
        {label} <span className="text-destructive">*</span>
      </Label>
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
