import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Building2, ShieldCheck, Pencil, Mail, MapPin } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { clearVendorDraft, readVendorDraft, type VendorDraft } from "@/lib/vendor-options";

export const Route = createFileRoute("/_authenticated/vendors/review")({
  head: () => ({
    meta: [
      { title: "Review Vendor Details | Continuum" },
      {
        name: "description",
        content:
          "Verify the vendor information extracted from your uploaded file before creating the vendor profile.",
      },
      { property: "og:title", content: "Review Vendor Details | Continuum" },
      {
        property: "og:description",
        content: "Verify extracted vendor information before creating the profile.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewVendorPage,
});

function ReviewVendorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VendorDraft | null>(null);
  const [editEntity, setEditEntity] = useState(false);
  const [editInternal, setEditInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readVendorDraft();
    if (!stored) navigate({ to: "/vendors/upload", replace: true });
    else setDraft(stored);
  }, [navigate]);

  if (!draft) return null;

  const update = (patch: Partial<VendorDraft>) => setDraft({ ...draft, ...patch });

  async function handleCreate() {
    if (!draft) return;
    setError(null);
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");
      const { error: insertError } = await supabase.from("vendors").insert({
        owner_id: uid,
        company_name: draft.company_name,
        country: draft.country,
        category: draft.category,
        internal_owner: draft.internal_owner,
        risk_level: draft.risk_level,
        email: draft.email,
        internal_vendor_id: draft.internal_vendor_id,
        source: draft.source,
      });
      if (insertError) throw insertError;
      clearVendorDraft();
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      navigate({ to: "/vendors" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the vendor profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <button
          type="button"
          onClick={() => navigate({ to: "/vendors/upload" })}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to File Upload
        </button>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-foreground">
          Review Vendor Details
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Please verify the information extracted from your uploaded file before proceeding to
          create the official vendor profile in the system.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <section className="rounded-2xl border border-border bg-card p-7 shadow-card">
            <header className="flex items-center gap-3 border-b border-border pb-4">
              <Building2 className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold text-foreground">Entity Information</h2>
              <button
                type="button"
                onClick={() => setEditEntity((v) => !v)}
                className="ml-auto flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Pencil className="h-4 w-4" /> {editEntity ? "Done" : "Edit"}
              </button>
            </header>

            {editEntity ? (
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <Field label="Company name" value={draft.company_name} onChange={(v) => update({ company_name: v })} />
                <Field label="Vendor category" value={draft.category} onChange={(v) => update({ category: v })} />
                <Field label="Country of registration" value={draft.country} onChange={(v) => update({ country: v })} />
                <Field label="Contact information" value={draft.email} onChange={(v) => update({ email: v })} />
              </div>
            ) : (
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <ReadField label="Company name" value={draft.company_name || "—"} />
                <ReadField
                  label="Vendor category"
                  value={draft.category || "—"}
                  icon={<span className="h-2 w-2 rounded-full bg-primary" />}
                />
                <ReadField
                  label="Country of registration"
                  value={draft.country || "—"}
                  icon={<MapPin className="h-4 w-4 text-muted-foreground" />}
                />
                <ReadField
                  label="Contact information"
                  value={draft.email || "—"}
                  icon={<Mail className="h-4 w-4 text-muted-foreground" />}
                />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-7 shadow-card">
            <header className="flex items-center gap-3 border-b border-border pb-4">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <h2 className="text-xl font-bold text-foreground">Internal Setup</h2>
              <button
                type="button"
                onClick={() => setEditInternal((v) => !v)}
                className="ml-auto text-primary hover:underline"
                aria-label="Edit internal setup"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-6 space-y-5">
              {editInternal ? (
                <>
                  <Field label="Internal vendor ID" value={draft.internal_vendor_id} onChange={(v) => update({ internal_vendor_id: v })} />
                  <Field label="Internal vendor owner" value={draft.internal_owner} onChange={(v) => update({ internal_owner: v })} />
                  <Field label="Initial risk assessment" value={draft.risk_level} onChange={(v) => update({ risk_level: v })} />
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Internal vendor ID
                    </p>
                    <p className="mt-2 rounded-lg bg-surface-container-low px-4 py-3 font-mono text-sm text-foreground">
                      {draft.internal_vendor_id || "—"}
                    </p>
                  </div>
                  <ReadField label="Internal vendor owner" value={draft.internal_owner || "—"} />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Initial risk assessment
                    </p>
                    <span className="mt-2 inline-flex rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-foreground">
                      {draft.risk_level || "—"}
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}

        <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !draft.company_name} className="px-6">
            Create Vendor Profile <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function ReadField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 flex items-center gap-2 text-base text-foreground">
        {icon}
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-11" />
    </div>
  );
}
