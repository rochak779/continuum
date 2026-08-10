import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowLeft, UploadCloud } from "lucide-react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { saveVendorDraft } from "@/lib/vendor-options";

export const Route = createFileRoute("/_authenticated/vendors/upload")({
  head: () => ({
    meta: [
      { title: "Upload Vendor File | Continuum" },
      {
        name: "description",
        content: "Upload a CSV, PDF or image file to import vendor records into Continuum.",
      },
      { property: "og:title", content: "Upload Vendor File | Continuum" },
      {
        property: "og:description",
        content: "Import vendor records from a file into Continuum.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadVendorFilePage,
});

function UploadVendorFilePage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleContinue() {
    if (!file) return;
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    saveVendorDraft({
      company_name: base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "",
      country: "",
      category: "",
      internal_owner: "",
      risk_level: "Medium",
      email: "",
      internal_vendor_id: `V-${Math.floor(10000 + Math.random() * 89999)}`,
      source: "file",
      file_name: file.name,
    });
    navigate({ to: "/vendors/review" });
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
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
              dragging ? "border-primary bg-accent" : "border-outline-variant"
            }`}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-primary">
              <UploadCloud className="h-8 w-8" />
            </span>
            <p className="mt-6 text-xl font-bold text-foreground">
              Drag and drop your file here, or click to browse
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Supported formats: PDF, CSV, and Images (JPG, PNG)
            </p>
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
              accept=".pdf,.csv,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="mt-8 flex justify-end">
            <Button disabled={!file} onClick={handleContinue} className="px-8">
              Continue
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
