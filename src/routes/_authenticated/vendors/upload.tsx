import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowLeft, Download, UploadCloud } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { parseVendorCsv } from "@/lib/csv";
import { saveVendorDraftRows, vendorCsvTemplate } from "@/lib/vendor-options";

export const Route = createFileRoute("/_authenticated/vendors/upload")({
  head: () => ({
    meta: [
      { title: "Upload Vendor File | Continuum" },
      {
        name: "description",
        content: "Upload a CSV of vendor records to bulk-import them into Continuum.",
      },
      { property: "og:title", content: "Upload Vendor File | Continuum" },
      {
        property: "og:description",
        content: "Bulk-import vendor records from a CSV file into Continuum.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadVendorFilePage,
});

function downloadTemplate() {
  const blob = new Blob([vendorCsvTemplate()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "continuum-vendor-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function UploadVendorFilePage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  function pickFile(candidate: File | null | undefined) {
    setError(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".csv")) {
      setError("Only CSV files are supported right now.");
      return;
    }
    setFile(candidate);
  }

  async function handleContinue() {
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const text = await file.text();
      const { rows, missingRequiredColumns } = parseVendorCsv(text);
      if (missingRequiredColumns.length > 0) {
        setError(
          `The CSV is missing required column(s): ${missingRequiredColumns
            .map((c) => (c === "companies_house_number" ? "Companies House Number" : "Company Name"))
            .join(", ")}. Download the template below to see the expected headers.`,
        );
        return;
      }
      if (rows.length === 0) {
        setError("No vendor rows were found in that file.");
        return;
      }
      saveVendorDraftRows(rows);
      navigate({ to: "/vendors/review" });
    } catch {
      setError("Could not read that file. Make sure it's a valid CSV.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate({ to: "/dashboard" })}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Upload Vendor File
          </h1>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-card">
          <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-container-low px-5 py-4">
            <p className="text-sm text-muted-foreground">
              Not sure how to format your file? Download our template with the expected columns.
            </p>
            <Button type="button" variant="outline" onClick={downloadTemplate} className="shrink-0">
              <Download className="mr-2 h-4 w-4" /> Download template
            </Button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
              dragging ? "border-primary bg-accent" : "border-outline-variant"
            }`}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-primary">
              <UploadCloud className="h-8 w-8" />
            </span>
            <p className="mt-6 text-xl font-bold text-foreground">
              Drag and drop your file here, or click to browse
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Supported format: CSV</p>
            <Button
              type="button"
              variant="outline"
              className="mt-6"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Select File
            </Button>
            {file && (
              <p className="mt-4 text-sm font-semibold text-primary">Selected: {file.name}</p>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}

          <div className="mt-8 flex justify-end">
            <Button disabled={!file || parsing} onClick={handleContinue} className="px-8">
              {parsing ? "Reading file…" : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
