import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import {
  RISK_LEVELS,
  VENDOR_CATEGORIES,
  VENDOR_COUNTRIES,
  clearVendorDraftRows,
  readVendorDraftRows,
  type VendorDraftRow,
} from "@/lib/vendor-options";
import { validateVendorRow, type VendorFieldName } from "@/lib/vendor-validation";
import { triggerInitialBaselineChecks } from "@/lib/vendor-monitoring";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/vendors/review")({
  head: () => ({
    meta: [
      { title: "Review Vendor Details | Continuum" },
      {
        name: "description",
        content: "Verify vendor information parsed from your upload before creating profiles.",
      },
      { property: "og:title", content: "Review Vendor Details | Continuum" },
      {
        property: "og:description",
        content: "Verify parsed vendor information before creating profiles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewVendorPage,
});

const TEXT_FIELDS: { key: keyof VendorDraftRow; label: string; placeholder?: string }[] = [
  { key: "company_name", label: "Company name" },
  { key: "companies_house_number", label: "Companies House number", placeholder: "e.g. 09876543" },
  { key: "internal_owner", label: "Internal owner" },
  { key: "email", label: "Email" },
  { key: "internal_vendor_id", label: "Internal vendor ID" },
];

function ReviewVendorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<VendorDraftRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = readVendorDraftRows();
    if (!stored) navigate({ to: "/vendors/upload", replace: true });
    else setRows(stored);
  }, [navigate]);

  const validations = useMemo(() => {
    if (!rows) return [];
    return rows.map((row) => validateVendorRow(row));
  }, [rows]);

  const validCount = validations.filter((v) => v.valid).length;
  const allValid = rows !== null && rows.length > 0 && validCount === rows.length;

  if (!rows) return null;

  function updateRow(id: string, patch: Partial<VendorDraftRow>) {
    setRows((current) => (current ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((current) => (current ?? []).filter((r) => r.id !== id));
  }

  async function handleCreate() {
    if (!rows || !allValid) return;
    setError(null);
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const payload = rows.map((row) => {
        const validated = validateVendorRow(row).data;
        // allValid guarantees this, but guard anyway rather than insert nulls.
        if (!validated) throw new Error(`"${row.company_name}" failed validation`);
        return { ...validated, owner_id: uid, source: row.source || "file" };
      });

      const { data: created, error: insertError } = await supabase
        .from("vendors")
        .insert(payload)
        .select("id, companies_house_number");
      if (insertError) throw insertError;

      clearVendorDraftRows();
      await queryClient.invalidateQueries({ queryKey: ["vendors"] });
      triggerInitialBaselineChecks(created ?? []);
      navigate({ to: "/vendors" });
    } catch (err) {
      console.error("Failed to create vendor profiles:", err);
      setError(getErrorMessage(err, "Could not create the vendor profiles"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px]">
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
          Fix anything flagged below. Every row must be valid — including a Companies House
          number, which is what turns on monitoring — before these vendors can be created.
        </p>

        <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                {TEXT_FIELDS.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                <TableHead>Country</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Risk level</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const fieldErrors = validations[i]?.fieldErrors ?? {};
                return (
                  <TableRow key={row.id}>
                    {TEXT_FIELDS.map((f) => (
                      <TableCell key={f.key} className="min-w-[160px] max-w-[280px] align-top">
                        <WrappingField
                          value={row[f.key]}
                          placeholder={f.placeholder}
                          error={fieldErrors[f.key as VendorFieldName]}
                          onChange={(v) => updateRow(row.id, { [f.key]: v })}
                        />
                      </TableCell>
                    ))}
                    <SelectCell
                      value={row.country}
                      options={VENDOR_COUNTRIES}
                      error={fieldErrors.country}
                      onChange={(v) => updateRow(row.id, { country: v })}
                    />
                    <SelectCell
                      value={row.category}
                      options={VENDOR_CATEGORIES}
                      error={fieldErrors.category}
                      onChange={(v) => updateRow(row.id, { category: v })}
                    />
                    <SelectCell
                      value={row.risk_level}
                      options={RISK_LEVELS}
                      error={fieldErrors.risk_level}
                      onChange={(v) => updateRow(row.id, { risk_level: v })}
                    />
                    <TableCell className="align-top">
                      <button
                        type="button"
                        aria-label="Remove row"
                        onClick={() => removeRow(row.id)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              All rows removed — go back and upload a file to try again.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {validCount} of {rows.length} row{rows.length === 1 ? "" : "s"} valid
          </p>
        </div>

        {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-6">
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !allValid} className="px-6">
            {saving
              ? "Creating…"
              : `Create ${rows.length} Vendor${rows.length === 1 ? "" : "s"}`}{" "}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * An editable cell that wraps and grows to fit its content instead of
 * truncating — a plain <input> can't wrap text, so long company names,
 * emails, etc. need a textarea sized to fit what's actually in it.
 */
function WrappingField({
  value,
  placeholder,
  error,
  onChange,
}: {
  value: string;
  placeholder?: string | undefined;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-input bg-surface-container-low px-2 py-1.5 text-sm leading-snug placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          error && "border-destructive",
        )}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </>
  );
}

function SelectCell({
  value,
  options,
  error,
  onChange,
}: {
  value: string;
  options: string[];
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <TableCell className="min-w-[160px] align-top">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-surface-container-low px-2 text-sm",
          error && "border-destructive",
        )}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </TableCell>
  );
}
