# Document Expiry Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user uploads a vendor document, extract (AI for PDF/image, manual for other types) an item label and expiry date, let the user confirm before saving, and surface upcoming expiries on the dashboard as Company / Item / Expiry date.

**Architecture:** Two new nullable columns on `vendor_documents` (`item_label`, `expiry_date`). A new server function calls Claude Sonnet 5 via the Vercel AI Gateway to read PDF/image files from Supabase Storage and suggest values; the existing upload flow in `VendorDocumentsCell` gains a review step where suggestions (or blank fields for other file types) are shown and edited before the `vendor_documents` row is inserted. The dashboard's existing monitoring query gains one more fetch and a pure helper joins it to vendor names for the "Upcoming Reviews & Expiries" panel.

**Tech Stack:** TanStack Start (`createServerFn`), Supabase (Postgres + Storage), `ai` package v7 (`generateText` + `Output.object`) via the Vercel AI Gateway (`anthropic/claude-sonnet-5`), React, Vitest.

## Global Constraints

- Server-only code (anything touching `supabaseAdmin` or the AI Gateway key) must live in `.server.ts` files, dynamically imported from the `createServerFn` handler — never imported at module top-level from route/component files. (Existing convention, see `resolve-alert-fn.ts` / `resolve-alert.server.ts`.)
- AI extraction failures must never throw or block the upload flow — always resolve to `{ itemLabel: null, expiryDate: null }` on any error.
- Only `application/pdf`, `image/png`, `image/jpeg` content types are sent to the model; doc/docx/xls/xlsx get blank manual-entry fields, no AI call.
- New DB columns are nullable; no backfill needed for existing rows.
- Testing convention: pure-logic `*.test.ts` only, no React component tests, no tests that make a live AI or Storage call.
- Use `generateText` with `output: Output.object({ schema })` from `ai` — **not** the deprecated standalone `generateObject`.
- Model string: `"anthropic/claude-sonnet-5"`, accessed via the AI Gateway (plain string, no provider SDK import).

---

### Task 1: Migration — add `item_label` and `expiry_date` columns

**Files:**
- Create: `supabase/migrations/20260811160000_vendor_document_expiry.sql`
- Modify: `src/integrations/supabase/types.ts:283-326` (the `vendor_documents` table block)

**Interfaces:**
- Produces: `vendor_documents.item_label: string | null`, `vendor_documents.expiry_date: string | null` (ISO date string, e.g. `"2027-01-15"`), available on the `Database["public"]["Tables"]["vendor_documents"]["Row"]` type from this point on for every later task.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260811160000_vendor_document_expiry.sql
--
-- Adds item_label and expiry_date to vendor_documents so uploaded
-- documents can carry a human-readable label and an expiry date, either
-- AI-extracted (PDF/image) or manually entered (all other file types).
-- Both nullable: not every document has (or needs) an expiry date.

alter table public.vendor_documents
  add column item_label text,
  add column expiry_date date;
```

- [ ] **Step 2: Update the generated types file by hand**

In `src/integrations/supabase/types.ts`, find the `vendor_documents` table block (currently around line 283) and add the two fields to `Row`, `Insert`, and `Update`, matching the existing style for nullable columns (see `content_type` in the same block for the pattern):

```ts
      vendor_documents: {
        Row: {
          content_type: string | null
          created_at: string
          expiry_date: string | null
          file_name: string
          file_size: number
          id: string
          item_label: string | null
          owner_id: string
          storage_path: string
          uploaded_by: string
          vendor_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          expiry_date?: string | null
          file_name: string
          file_size: number
          id?: string
          item_label?: string | null
          owner_id: string
          storage_path: string
          uploaded_by: string
          vendor_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string
          expiry_date?: string | null
          file_name?: string
          file_size?: number
          id?: string
          item_label?: string | null
          owner_id?: string
          storage_path?: string
          uploaded_by?: string
          vendor_id?: string
        }
```

Keep every other field/line in that block (the `uploaded_by` field, `Relationships` array, etc.) exactly as-is — only add the two new fields, alphabetically placed like the rest of the block already is.

- [ ] **Step 3: Apply the migration locally**

Run: `supabase db push` (or whatever this project's existing local Supabase workflow is — check `README.md` / `supabase/config.toml` if `db push` isn't already the established command used for prior migrations in this repo's history)

Expected: migration applies with no errors; `vendor_documents` now has `item_label` and `expiry_date` columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260811160000_vendor_document_expiry.sql src/integrations/supabase/types.ts
git commit -m "feat(vendor-documents): add item_label and expiry_date columns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `normalize-extraction.ts` — pure date normalization helper

**Files:**
- Create: `src/integrations/document-extraction/normalize-extraction.ts`
- Test: `src/integrations/document-extraction/normalize-extraction.test.ts`

**Interfaces:**
- Produces: `normalizeExtractedDate(value: string | null | undefined): string | null` — used by Task 3's server implementation to sanitize the model's raw `expiryDate` output before returning it to the client.

- [ ] **Step 1: Write the failing tests**

```ts
// src/integrations/document-extraction/normalize-extraction.test.ts
import { describe, expect, it } from "vitest";

import { normalizeExtractedDate } from "./normalize-extraction";

describe("normalizeExtractedDate", () => {
  it("passes through a valid ISO date", () => {
    expect(normalizeExtractedDate("2027-01-15")).toBe("2027-01-15");
  });

  it("returns null for null input", () => {
    expect(normalizeExtractedDate(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeExtractedDate(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeExtractedDate("")).toBeNull();
  });

  it("returns null for unparseable garbage", () => {
    expect(normalizeExtractedDate("not a date")).toBeNull();
  });

  it("returns null for a non-date string like a document number", () => {
    expect(normalizeExtractedDate("INV-2027-001")).toBeNull();
  });

  it("normalizes a parseable but non-ISO date string to ISO", () => {
    expect(normalizeExtractedDate("January 15, 2027")).toBe("2027-01-15");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/integrations/document-extraction/normalize-extraction.test.ts`
Expected: FAIL — `normalize-extraction.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/integrations/document-extraction/normalize-extraction.ts
//
// Coerces the AI model's raw `expiryDate` output into a valid ISO date
// string (YYYY-MM-DD) or null. The model is prompted to return an ISO date
// or null, but structured output doesn't guarantee well-formed date
// strings — this is the safety net before the value ever reaches the DB.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeExtractedDate(value: string | null | undefined): string | null {
  if (!value || value.trim().length === 0) return null;

  const trimmed = value.trim();
  if (ISO_DATE_PATTERN.test(trimmed)) {
    // Already ISO — still verify it's a real calendar date (e.g. reject "2027-02-31").
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/integrations/document-extraction/normalize-extraction.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/document-extraction/normalize-extraction.ts src/integrations/document-extraction/normalize-extraction.test.ts
git commit -m "feat(document-extraction): add expiry date normalization helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `ai` package + AI Gateway env var setup

**Files:**
- Modify: `package.json` (already done — `ai` is installed; verify only)
- Modify: `.env.example` (if this file exists in the repo — add `AI_GATEWAY_API_KEY`; skip this step if no `.env.example` exists in the repo root)

**Interfaces:**
- Produces: confirms `ai@^7.x` is available as a dependency and `AI_GATEWAY_API_KEY` (or Vercel's OIDC-based auth in deployed environments) is the documented way `extract-document-fields.server.ts` (Task 4) authenticates to the Gateway.

- [ ] **Step 1: Verify `ai` is installed**

Run: `grep '"ai":' package.json`
Expected: a line like `"ai": "^7.0.59",` — this was already added earlier in this session via `npm install ai@latest`. If missing, run `npm install ai@latest --save` now.

- [ ] **Step 2: Check for an existing `.env.example` and add the Gateway key if present**

Run: `ls .env.example 2>/dev/null || echo "no .env.example in repo"`

If the file exists, add (following whatever format the file already uses for other keys like `COMPANIES_HOUSE_API_KEY`):

```
AI_GATEWAY_API_KEY=
```

If no `.env.example` exists in the repo, skip this step — this project doesn't use one, and Vercel deployments authenticate to the Gateway via OIDC automatically with no key needed.

- [ ] **Step 3: Set the local dev env var**

Run (only needed for `npm run dev` / `npm test` locally, not for the deployed app): `vercel env pull` (if this project is Vercel-linked and the Gateway key is already provisioned on the team) — otherwise get an AI Gateway API key from the Vercel dashboard and set `AI_GATEWAY_API_KEY` in `.env.local`.

Expected: `AI_GATEWAY_API_KEY` is present in the local environment before Task 4's server function is exercised in dev.

- [ ] **Step 4: Commit (only if `.env.example` was modified)**

```bash
git add .env.example
git commit -m "chore: document AI_GATEWAY_API_KEY env var

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

If nothing was modified (no `.env.example` in repo), skip the commit — there's nothing to commit for this task.

---

### Task 4: `extract-document-fields.server.ts` — AI extraction implementation

**Files:**
- Create: `src/integrations/document-extraction/extract-document-fields.server.ts`

**Interfaces:**
- Consumes: `supabaseAdmin` from `@/integrations/supabase/client.server` (existing); `normalizeExtractedDate` from `./normalize-extraction` (Task 2).
- Produces: `extractDocumentFields(input: { storagePath: string; contentType: string }): Promise<{ itemLabel: string | null; expiryDate: string | null }>` — used by Task 5's `createServerFn` wrapper. Never throws.

- [ ] **Step 1: Write the implementation**

```ts
// src/integrations/document-extraction/extract-document-fields.server.ts
//
// Server-only: downloads a document from the private vendor-documents
// Storage bucket and asks Claude to identify what the document is and
// when it expires. Best-effort — any failure (download, model call,
// malformed response) resolves to nulls rather than throwing, since
// extraction must never block the upload it's attached to.
//
// Only called for content types Claude can read directly as a file part
// (PDF and common image types). Word/Excel uploads never reach this
// function — the caller skips it and leaves fields blank for manual entry.

import { generateText, Output } from "ai";
import { z } from "zod";

const BUCKET = "vendor-documents";

const EXTRACTABLE_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const extractionSchema = z.object({
  itemLabel: z
    .string()
    .nullable()
    .describe(
      'A short human-readable label for what kind of document this is, e.g. "Insurance Certificate", "Business License", "NDA". Null if it cannot be determined.',
    ),
  expiryDate: z
    .string()
    .nullable()
    .describe(
      "The document's expiration/expiry date as an ISO date string (YYYY-MM-DD), if the document states one. Null if the document has no expiry date or none is stated. Do not confuse with an issue date, effective date, or signing date.",
    ),
});

export interface ExtractedDocumentFields {
  itemLabel: string | null;
  expiryDate: string | null;
}

const NULL_RESULT: ExtractedDocumentFields = { itemLabel: null, expiryDate: null };

export function isExtractableContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && EXTRACTABLE_CONTENT_TYPES.has(contentType));
}

export async function extractDocumentFields(input: {
  storagePath: string;
  contentType: string;
}): Promise<ExtractedDocumentFields> {
  if (!isExtractableContentType(input.contentType)) return NULL_RESULT;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normalizeExtractedDate } = await import("./normalize-extraction");

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(input.storagePath);
    if (error || !data) {
      console.error("[document-extraction] Failed to download document:", error);
      return NULL_RESULT;
    }

    const bytes = new Uint8Array(await data.arrayBuffer());

    const result = await generateText({
      model: "anthropic/claude-sonnet-5",
      output: Output.object({ schema: extractionSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify what kind of document this is and, if stated, its expiry/expiration date. This is a vendor compliance document (e.g. insurance certificate, license, contract).",
            },
            {
              type: "file",
              mediaType: input.contentType,
              data: bytes,
            },
          ],
        },
      ],
    });

    return {
      itemLabel: result.output.itemLabel,
      expiryDate: normalizeExtractedDate(result.output.expiryDate),
    };
  } catch (err) {
    console.error("[document-extraction] Extraction failed:", err);
    return NULL_RESULT;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the new file. If `generateText`/`Output`/message content-part types don't match, re-check `node_modules/ai/docs/02-foundations/03-prompts.mdx` and `node_modules/ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx` for the exact current shape rather than guessing.

- [ ] **Step 3: Commit**

```bash
git add src/integrations/document-extraction/extract-document-fields.server.ts
git commit -m "feat(document-extraction): add AI-backed field extraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `extract-document-fields-fn.ts` — server function wrapper

**Files:**
- Create: `src/integrations/document-extraction/extract-document-fields-fn.ts`

**Interfaces:**
- Consumes: `extractDocumentFields` and `ExtractedDocumentFields` from `./extract-document-fields.server` (Task 4, dynamically imported).
- Produces: `extractDocumentFieldsFn` — a `createServerFn({ method: "POST" })` callable from client code as `extractDocumentFieldsFn({ data: { storagePath, contentType } })`, returning `ExtractedDocumentFields`. Used by Task 6's upload/review UI.

- [ ] **Step 1: Write the implementation**

```ts
// src/integrations/document-extraction/extract-document-fields-fn.ts
//
// TanStack Start server function wrapper around extractDocumentFields.
// Client code calls this instead of importing the .server.ts module
// directly, keeping supabaseAdmin and the AI Gateway call server-only
// (same convention as resolve-alert-fn.ts).

import { createServerFn } from "@tanstack/react-start";

export interface ExtractDocumentFieldsFnInput {
  storagePath: string;
  contentType: string;
}

function validateInput(input: ExtractDocumentFieldsFnInput): ExtractDocumentFieldsFnInput {
  if (!input || typeof input.storagePath !== "string" || !input.storagePath) {
    throw new Error("storagePath is required");
  }
  if (typeof input.contentType !== "string" || !input.contentType) {
    throw new Error("contentType is required");
  }
  return { storagePath: input.storagePath, contentType: input.contentType };
}

export const extractDocumentFieldsFn = createServerFn({ method: "POST" })
  .validator(validateInput)
  .handler(async ({ data }) => {
    const { extractDocumentFields } = await import("./extract-document-fields.server");
    return extractDocumentFields(data);
  });
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/integrations/document-extraction/extract-document-fields-fn.ts
git commit -m "feat(document-extraction): add extractDocumentFieldsFn server function

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `VendorDocumentsCell` — upload → review → save/discard flow

**Files:**
- Modify: `src/components/app/VendorDocumentsCell.tsx`

**Interfaces:**
- Consumes: `extractDocumentFieldsFn` and `ExtractDocumentFieldsFnInput` (Task 5); `isExtractableContentType` from `@/integrations/document-extraction/extract-document-fields.server` — **do not** import this directly, since it's a `.server.ts` file; instead inline an equivalent client-safe check (see implementation below) so the client bundle never pulls in server-only code.
- Produces: no new exports — this is a leaf component. Behavior change: `handleFilesSelected` no longer inserts `vendor_documents` rows directly; it stages files into review state, and a new `handleSaveReview`/`handleDiscardReview` pair does the inserting/cleanup.

This is a substantial rewrite of the upload path in an existing file with no component tests (matches this repo's convention), so there's no automated test step here — verify manually per Step 4 below, consistent with how the original vendor-documents feature was verified.

- [ ] **Step 1: Replace the upload handler and add review state**

Rewrite `src/components/app/VendorDocumentsCell.tsx` as follows (full file, since the control flow changes throughout):

```tsx
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { extractDocumentFieldsFn } from "@/integrations/document-extraction/extract-document-fields-fn";
import { getErrorMessage } from "@/lib/errors";
import { formatFileSize, validateDocumentFile } from "@/lib/vendor-documents";

const BUCKET = "vendor-documents";

// Kept in sync with EXTRACTABLE_CONTENT_TYPES in
// extract-document-fields.server.ts. Duplicated (rather than imported)
// because that module is server-only and must never reach the client
// bundle; this just decides whether to show a "detecting…" spinner.
const EXTRACTABLE_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (extension && EXTENSION_MIME_TYPES[extension]) || "application/octet-stream";
}

interface ReviewItem {
  fileName: string;
  storagePath: string;
  contentType: string;
  fileSize: number;
  itemLabel: string;
  expiryDate: string; // "" or "YYYY-MM-DD", for the <input type="date"> value
  extracting: boolean;
}

export function VendorDocumentsCell({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);

  const queryKey = ["vendor-documents", vendorId];

  const { data: documents, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error: fetchError } = await supabase
        .from("vendor_documents")
        .select("id, file_name, storage_path, file_size, item_label, expiry_date, created_at")
        .eq("vendor_id", vendorId)
        .order("created_at", { ascending: false });
      if (fetchError) throw fetchError;
      return data;
    },
  });

  type VendorDocument = NonNullable<typeof documents>[number];

  const list = documents ?? [];

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const rejected: string[] = [];
      const failed: string[] = [];
      const staged: ReviewItem[] = [];

      for (const file of Array.from(files)) {
        const validation = validateDocumentFile({ name: file.name, size: file.size });
        if (!validation.valid) {
          rejected.push(`${file.name} (${validation.reason})`);
          continue;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `${uid}/${vendorId}/${crypto.randomUUID()}-${safeName}`;
        const resolvedType = resolveMimeType(file);
        const uploadFile = file.type === resolvedType ? file : new File([file], file.name, { type: resolvedType });
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, uploadFile, { contentType: resolvedType });
        if (uploadError) {
          failed.push(file.name);
          continue;
        }
        staged.push({
          fileName: file.name,
          storagePath,
          contentType: resolvedType,
          fileSize: file.size,
          itemLabel: "",
          expiryDate: "",
          extracting: EXTRACTABLE_CONTENT_TYPES.has(resolvedType),
        });
      }

      const messages: string[] = [];
      if (rejected.length > 0) messages.push(`Skipped: ${rejected.join(", ")}`);
      if (failed.length > 0) messages.push(`Failed to upload: ${failed.join(", ")}`);
      if (messages.length > 0) setError(messages.join(" "));

      if (staged.length > 0) {
        setReview((current) => [...current, ...staged]);
        for (const item of staged) {
          if (!item.extracting) continue;
          extractDocumentFieldsFn({
            data: { storagePath: item.storagePath, contentType: item.contentType },
          })
            .then((result) => {
              setReview((current) =>
                current.map((r) =>
                  r.storagePath === item.storagePath
                    ? {
                        ...r,
                        itemLabel: result.itemLabel ?? r.itemLabel,
                        expiryDate: result.expiryDate ?? r.expiryDate,
                        extracting: false,
                      }
                    : r,
                ),
              );
            })
            .catch(() => {
              setReview((current) =>
                current.map((r) => (r.storagePath === item.storagePath ? { ...r, extracting: false } : r)),
              );
            });
        }
      }
    } catch (err) {
      console.error("Failed to upload vendor document:", err);
      setError(getErrorMessage(err, "Could not upload the document"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function updateReviewItem(storagePath: string, patch: Partial<Pick<ReviewItem, "itemLabel" | "expiryDate">>) {
    setReview((current) => current.map((r) => (r.storagePath === storagePath ? { ...r, ...patch } : r)));
  }

  async function handleSaveReview() {
    setError(null);
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const rows = review.map((item) => ({
        vendor_id: vendorId,
        owner_id: uid,
        file_name: item.fileName,
        storage_path: item.storagePath,
        file_size: item.fileSize,
        content_type: item.contentType,
        uploaded_by: uid,
        item_label: item.itemLabel.trim() || null,
        expiry_date: item.expiryDate || null,
      }));

      const { error: insertError } = await supabase.from("vendor_documents").insert(rows);
      if (insertError) throw insertError;

      setReview([]);
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      console.error("Failed to save vendor documents:", err);
      setError(getErrorMessage(err, "Could not save the documents"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscardReview() {
    setError(null);
    const paths = review.map((item) => item.storagePath);
    setReview([]);
    if (paths.length === 0) return;
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      console.error("Failed to clean up discarded documents:", removeError);
    }
  }

  async function handleDownload(doc: VendorDocument) {
    setError(null);
    const { data, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
    if (urlError || !data) {
      setError(getErrorMessage(urlError, "Could not open the document"));
      return;
    }
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function handleDelete(doc: VendorDocument) {
    setError(null);
    try {
      const { error: deleteError } = await supabase.from("vendor_documents").delete().eq("id", doc.id);
      if (deleteError) throw deleteError;
      await queryClient.invalidateQueries({ queryKey });
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      if (removeError) throw removeError;
    } catch (err) {
      console.error("Failed to delete vendor document:", err);
      setError(getErrorMessage(err, "Could not delete the document"));
    }
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
      className="hidden"
      onChange={(e) => handleFilesSelected(e.target.files)}
    />
  );

  const reviewPanel = review.length > 0 && (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground">Review before saving</p>
      {review.map((item) => (
        <div key={item.storagePath} className="space-y-1.5">
          <p className="truncate text-sm font-medium text-foreground">{item.fileName}</p>
          <div className="flex items-center gap-2">
            <Input
              placeholder={item.extracting ? "Detecting…" : "Item (e.g. Insurance Certificate)"}
              value={item.itemLabel}
              disabled={item.extracting}
              onChange={(e) => updateReviewItem(item.storagePath, { itemLabel: e.target.value })}
              className="h-8 text-sm"
            />
            <Input
              type="date"
              value={item.expiryDate}
              disabled={item.extracting}
              onChange={(e) => updateReviewItem(item.storagePath, { expiryDate: e.target.value })}
              className="h-8 w-36 text-sm"
            />
            {item.extracting && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={handleSaveReview}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save {review.length} document{review.length === 1 ? "" : "s"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={handleDiscardReview}>
          Discard
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return <span className="text-muted-foreground">…</span>;
  }

  if (isError) {
    return <span className="text-xs text-destructive">Could not load documents</span>;
  }

  if (list.length === 0 && review.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">No document uploaded</span>
        {fileInput}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Upload documents"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  if (list.length === 0 && review.length > 0) {
    // Nothing saved yet, but files are staged for review — open the review UI directly
    // instead of behind the "N documents" trigger (there's no chip to click yet).
    return (
      <div className="w-80 space-y-3 rounded-lg border border-border p-3">
        {fileInput}
        {reviewPanel}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <Popover defaultOpen={review.length > 0}>
      {fileInput}
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
        >
          <FileText className="h-4 w-4" />
          {list.length} document{list.length === 1 ? "" : "s"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          {list.map((doc) => (
            <div key={doc.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`Download ${doc.file_name}`}
                  onClick={() => handleDownload(doc)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${doc.file_name}`}
                  onClick={() => handleDelete(doc)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {reviewPanel}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload more
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify `Input` component supports `type="date"` cleanly**

Run: `grep -n "type" src/components/ui/input.tsx`
Expected: it's a thin wrapper around a native `<input>` that forwards `type` (standard shadcn/ui pattern) — if it hardcodes `type="text"` internally, adjust the `<Input type="date" .../>` usage above to a plain `<input type="date" className="..." />` matching the existing Tailwind classes instead.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, sign in, go to Vendors, click Upload on a vendor row, select a PDF with a visible expiry date (or a plain image), confirm:
- File uploads, a review row appears with a spinner, then Item/Expiry pre-fill (or stay blank if the model found nothing).
- Editing the fields works.
- "Save" writes the document (it now appears in the "N documents" list) and clears the review panel.
- Re-opening the popover, uploading a `.docx`, confirms Item/Expiry start blank with no spinner, and "Save" with blank fields succeeds (nulls stored).
- "Discard" removes the staged review row without adding a document to the list.

- [ ] **Step 5: Commit**

```bash
git add src/components/app/VendorDocumentsCell.tsx
git commit -m "feat(vendor-documents): add expiry extraction review step to upload flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `buildUpcomingExpiries` — dashboard data helper

**Files:**
- Modify: `src/lib/dashboard-data.ts`
- Modify: `src/lib/dashboard-data.test.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `buildUpcomingExpiries(documents: readonly DashboardDocument[], vendorNames: ReadonlyMap<string, string>): UpcomingExpiry[]` and the `DashboardDocument`/`UpcomingExpiry` types — used by Task 8's dashboard route.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboard-data.test.ts`:

```ts
import { buildUpcomingExpiries } from "./dashboard-data";

describe("buildUpcomingExpiries", () => {
  const vendorNames = new Map([
    ["v1", "Acme Insurance"],
    ["v2", "Beta Logistics"],
  ]);

  it("joins vendor names and prefers item_label over file_name", () => {
    const result = buildUpcomingExpiries(
      [
        {
          id: "d1",
          vendor_id: "v1",
          item_label: "Insurance Certificate",
          file_name: "cert.pdf",
          expiry_date: "2027-01-15",
        },
      ],
      vendorNames,
    );
    expect(result).toEqual([
      { id: "d1", companyName: "Acme Insurance", item: "Insurance Certificate", expiryDate: "2027-01-15" },
    ]);
  });

  it("falls back to file_name when item_label is null", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: null, file_name: "cert.pdf", expiry_date: "2027-01-15" }],
      vendorNames,
    );
    expect(result[0]?.item).toBe("cert.pdf");
  });

  it("falls back to 'Unknown vendor' when the vendor id isn't in the map", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "missing", item_label: "X", file_name: "x.pdf", expiry_date: "2027-01-15" }],
      vendorNames,
    );
    expect(result[0]?.companyName).toBe("Unknown vendor");
  });

  it("excludes documents with a null expiry_date", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: "X", file_name: "x.pdf", expiry_date: null }],
      vendorNames,
    );
    expect(result).toEqual([]);
  });

  it("excludes already-past expiry dates", () => {
    const result = buildUpcomingExpiries(
      [{ id: "d1", vendor_id: "v1", item_label: "X", file_name: "x.pdf", expiry_date: "2000-01-01" }],
      vendorNames,
    );
    expect(result).toEqual([]);
  });

  it("sorts by soonest expiry first, defensively re-sorting unsorted input", () => {
    const result = buildUpcomingExpiries(
      [
        { id: "later", vendor_id: "v1", item_label: "Later", file_name: "x.pdf", expiry_date: "2030-01-01" },
        { id: "sooner", vendor_id: "v2", item_label: "Sooner", file_name: "y.pdf", expiry_date: "2028-01-01" },
      ],
      vendorNames,
    );
    expect(result.map((r) => r.id)).toEqual(["sooner", "later"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dashboard-data.test.ts`
Expected: FAIL — `buildUpcomingExpiries` is not exported yet.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/dashboard-data.ts`:

```ts
export interface DashboardDocument {
  id: string;
  vendor_id: string;
  item_label: string | null;
  file_name: string;
  expiry_date: string | null;
}

export interface UpcomingExpiry {
  id: string;
  companyName: string;
  item: string;
  expiryDate: string;
}

/**
 * Builds the "Upcoming Reviews & Expiries" dashboard rows: joins each
 * document to its vendor's company name, prefers the user-set item_label
 * over the raw file_name, and excludes documents with no expiry date or an
 * already-past one (defensive — callers should already filter server-side,
 * but this shouldn't assume pre-filtered/pre-sorted input).
 */
export function buildUpcomingExpiries(
  documents: readonly DashboardDocument[],
  vendorNames: ReadonlyMap<string, string>,
): UpcomingExpiry[] {
  const today = new Date().toISOString().slice(0, 10);
  return documents
    .filter((doc): doc is DashboardDocument & { expiry_date: string } => Boolean(doc.expiry_date))
    .filter((doc) => doc.expiry_date >= today)
    .map((doc) => ({
      id: doc.id,
      companyName: vendorNames.get(doc.vendor_id) ?? "Unknown vendor",
      item: doc.item_label ?? doc.file_name,
      expiryDate: doc.expiry_date,
    }))
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dashboard-data.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-data.ts src/lib/dashboard-data.test.ts
git commit -m "feat(dashboard): add buildUpcomingExpiries helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire the dashboard query and render the panel

**Files:**
- Modify: `src/routes/_authenticated/dashboard.tsx`

**Interfaces:**
- Consumes: `buildUpcomingExpiries`, `DashboardDocument`, `UpcomingExpiry` from `@/lib/dashboard-data` (Task 7).
- Produces: nothing new — this is the final integration point; no later task depends on it.

- [ ] **Step 1: Add the query fetch**

In `src/routes/_authenticated/dashboard.tsx`, update the import (`dashboard.tsx:23-28`):

```ts
import {
  buildDashboardSummary,
  buildUpcomingExpiries,
  describeFailure,
  latestFailureByVendor,
  normalizeAlertSeverity,
} from "@/lib/dashboard-data";
```

In the `queryFn` (`dashboard.tsx:96-136`), add a fifth parallel fetch and destructure/return it:

```ts
    queryFn: async () => {
      const [vendorsResult, alertsResult, changesResult, failuresResult, documentsResult] = await Promise.all([
        supabase
          .from("vendors")
          .select("id, company_name, category, risk_level, monitoring_status, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_monitoring_alerts")
          .select(
            "id, vendor_id, severity, status, attribute_checked, previous_value, new_value, detected_at",
          )
          .neq("status", "resolved")
          .order("detected_at", { ascending: false }),
        supabase
          .from("vendor_change_events")
          .select(
            "id, vendor_id, attribute_key, previous_value, new_value, severity, detected_at, snapshot_id",
          )
          .in("severity", ["critical", "attention"])
          .order("detected_at", { ascending: false })
          .limit(5),
        supabase
          .from("vendor_monitoring_failures")
          .select("vendor_id, error_type, message, checked_at")
          .order("checked_at", { ascending: false })
          // Bounds the payload; append-only log can grow unbounded. A vendor's most
          // recent failure could theoretically fall outside this window if the log
          // grows very large, silently dropping its status tooltip — known limitation.
          .limit(500),
        supabase
          .from("vendor_documents")
          .select("id, vendor_id, item_label, file_name, expiry_date")
          .not("expiry_date", "is", null)
          .gte("expiry_date", new Date().toISOString().slice(0, 10))
          .order("expiry_date", { ascending: true })
          .limit(5),
      ]);
      if (vendorsResult.error) throw vendorsResult.error;
      if (alertsResult.error) throw alertsResult.error;
      if (changesResult.error) throw changesResult.error;
      if (failuresResult.error) throw failuresResult.error;
      if (documentsResult.error) throw documentsResult.error;
      return {
        vendors: vendorsResult.data,
        alerts: alertsResult.data,
        changes: changesResult.data,
        failures: failuresResult.data,
        documents: documentsResult.data,
      };
    },
```

- [ ] **Step 2: Build the row data**

After the existing `const vendorNames = new Map(...)` line (`dashboard.tsx:160`), add:

```ts
  const documents = data?.documents ?? [];
  const upcomingExpiries = buildUpcomingExpiries(documents, vendorNames);
```

- [ ] **Step 3: Render the panel**

Replace the "Upcoming Reviews & Expiries" panel body (`dashboard.tsx:335-337`):

```tsx
        <Panel title="Upcoming Reviews & Expiries" action="View All">
          {isLoading ? (
            <PanelState>Loading upcoming expiries…</PanelState>
          ) : upcomingExpiries.length === 0 ? (
            <PanelState>No upcoming reviews or expiries.</PanelState>
          ) : (
            <div className="space-y-4">
              {upcomingExpiries.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{row.companyName}</p>
                    <p className="truncate text-sm text-muted-foreground">{row.item}</p>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {new Date(row.expiryDate).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing and new tests pass.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, sign in, upload+save a document with an expiry date in the future for a vendor (per Task 6's manual test), go to the Dashboard, confirm the "Upcoming Reviews & Expiries" panel shows Company / Item / Expiry date for that document. Upload one with a past date and confirm it's excluded.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/dashboard.tsx
git commit -m "feat(dashboard): surface upcoming document expiries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `normalize-extraction.test.ts` and updated `dashboard-data.test.ts`.

- [ ] **Step 2: Run the linter and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Push the branch and open a PR**

```bash
git push -u origin HEAD
gh pr create --fill
```

(Per this project's established workflow — feature branch + PR, not a direct push to `main`.)

Expected: PR opens against `main` with all 8 feature commits from Tasks 1–8.
