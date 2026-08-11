# Vendor Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Documents" column to the vendors list that shows "No document uploaded" when a vendor has no files, and lets the internal user upload, view, download, and delete files per vendor.

**Architecture:** A new `vendor_documents` table (RLS-scoped like `vendors`) plus a private Supabase Storage bucket `vendor-documents` hold the files. A single self-contained `VendorDocumentsCell` component (one per table row) fetches its own vendor's documents via react-query and handles upload/download/delete directly against Supabase, matching this codebase's existing pattern of colocating Supabase calls in the component rather than a separate API layer.

**Tech Stack:** React, TanStack Query, TanStack Router, Supabase (Postgres + Storage), Tailwind, shadcn/ui (`Popover`, `Button`), lucide-react icons, Vitest.

## Global Constraints

- RLS/ownership model: every row and every Storage object is scoped to `owner_id = auth.uid()`, matching `supabase/migrations/20260810111100_*.sql`'s pattern for `vendors`. No cross-user access.
- Allowed file types: `.pdf, .png, .jpg, .jpeg, .doc, .docx, .xls, .xlsx`. Max size: 10MB per file. Enforced both client-side (immediate feedback) and at the Storage bucket level (backstop).
- Uploads are internal-team-only (authenticated Continuum users) — no public/external upload path in this plan.
- No fixed/required document checklist — flat, open-ended list of files per vendor.
- No file versioning — delete + re-upload only.
- Follow existing code conventions: manual `async`/`useState` handlers for mutations (see `src/routes/_authenticated/vendors/new.tsx`), not `useMutation`; `getErrorMessage` from `src/lib/errors.ts` for error text; Vitest for logic-only unit tests, no React component tests (none exist in this repo).

---

### Task 1: Database migration — `vendor_documents` table + `vendor-documents` storage bucket

**Files:**
- Create: `supabase/migrations/20260811150000_vendor_documents.sql`
- Modify: `src/integrations/supabase/types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: table `public.vendor_documents` with columns `id, vendor_id, owner_id, file_name, storage_path, file_size, content_type, uploaded_by, created_at`; Storage bucket `vendor-documents` (private, 10MB limit, restricted MIME types); RLS/Storage policies scoped to `owner_id = auth.uid()` and to the first path segment of each object (`{owner_id}/{vendor_id}/{uuid}-{filename}`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260811150000_vendor_documents.sql

create table public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  owner_id uuid not null,
  file_name text not null,
  storage_path text not null,
  file_size bigint not null,
  content_type text,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index vendor_documents_vendor_id_idx on public.vendor_documents(vendor_id);

alter table public.vendor_documents enable row level security;

create policy "Users can view their own vendor documents"
  on public.vendor_documents for select to authenticated
  using (owner_id = auth.uid());

create policy "Users can insert their own vendor documents"
  on public.vendor_documents for insert to authenticated
  with check (owner_id = auth.uid());

create policy "Users can delete their own vendor documents"
  on public.vendor_documents for delete to authenticated
  using (owner_id = auth.uid());

-- Storage bucket for the actual files. Objects are stored under
-- {owner_id}/{vendor_id}/{uuid}-{filename}, so Storage RLS can check
-- ownership from the first path segment without joining back to
-- vendor_documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-documents',
  'vendor-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

create policy "Users can view their own vendor document objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own vendor document objects"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own vendor document objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'vendor-documents' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Apply the migration to the linked project**

Run: `supabase db push`
Expected: prompts to apply `20260811150000_vendor_documents.sql`, then confirms it applied successfully.

- [ ] **Step 3: Verify it applied**

Run: `supabase migration list`
Expected: `20260811150000` appears in both the `local` and `remote` columns.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `supabase gen types typescript --linked --schema public > src/integrations/supabase/types.ts`
Expected: the command succeeds; `grep -n "vendor_documents" src/integrations/supabase/types.ts` shows the new table's `Row`/`Insert`/`Update` types.

- [ ] **Step 5: Confirm the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors (there was no code referencing `vendor_documents` yet, so this should be clean).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811150000_vendor_documents.sql src/integrations/supabase/types.ts
git commit -m "feat(vendors): add vendor_documents table and storage bucket"
```

---

### Task 2: Document validation/formatting helpers

**Files:**
- Create: `src/lib/vendor-documents.ts`
- Test: `src/lib/vendor-documents.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no dependencies on Supabase or React).
- Produces: `ALLOWED_DOCUMENT_EXTENSIONS: readonly string[]`, `MAX_DOCUMENT_SIZE_BYTES: number`, `validateDocumentFile(file: { name: string; size: number }): { valid: true } | { valid: false; reason: string }`, `formatFileSize(bytes: number): string` — used by `VendorDocumentsCell` in Task 3.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/vendor-documents.test.ts
import { describe, expect, it } from "vitest";

import { formatFileSize, MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "./vendor-documents";

describe("validateDocumentFile", () => {
  it("accepts an allowed extension under the size limit", () => {
    expect(validateDocumentFile({ name: "insurance.pdf", size: 1024 })).toEqual({ valid: true });
  });

  it("is case-insensitive on the extension", () => {
    expect(validateDocumentFile({ name: "insurance.PDF", size: 1024 })).toEqual({ valid: true });
  });

  it("rejects a disallowed extension", () => {
    const result = validateDocumentFile({ name: "insurance.zip", size: 1024 });
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/type/i);
  });

  it("rejects a file with no extension", () => {
    const result = validateDocumentFile({ name: "insurance", size: 1024 });
    expect(result.valid).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const result = validateDocumentFile({ name: "insurance.pdf", size: MAX_DOCUMENT_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/size|large|10\s*MB/i);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateDocumentFile({ name: "insurance.pdf", size: MAX_DOCUMENT_SIZE_BYTES })).toEqual({
      valid: true,
    });
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(formatFileSize(1_500_000)).toBe("1.4 MB");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/vendor-documents.test.ts`
Expected: FAIL — `src/lib/vendor-documents.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/vendor-documents.ts

export const ALLOWED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "doc",
  "docx",
  "xls",
  "xlsx",
] as const;

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export type DocumentValidationResult = { valid: true } | { valid: false; reason: string };

/**
 * Client-side gate before a file reaches Supabase Storage. The bucket's
 * own file_size_limit/allowed_mime_types are the backstop — this just
 * gives the user immediate, specific feedback instead of a generic
 * Storage error.
 */
export function validateDocumentFile(file: { name: string; size: number }): DocumentValidationResult {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      valid: false,
      reason: `Unsupported file type. Allowed: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}`,
    };
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { valid: false, reason: "File is larger than the 10 MB limit" };
  }
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/vendor-documents.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/vendor-documents.ts src/lib/vendor-documents.test.ts
git commit -m "feat(vendors): add document validation and formatting helpers"
```

---

### Task 3: `VendorDocumentsCell` component

**Files:**
- Create: `src/components/app/VendorDocumentsCell.tsx`

**Interfaces:**
- Consumes: `validateDocumentFile`, `formatFileSize` from `src/lib/vendor-documents.ts` (Task 2); `getErrorMessage` from `src/lib/errors.ts`; `supabase` from `src/integrations/supabase/client.ts`; `Button` from `@/components/ui/button`; `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`.
- Produces: `VendorDocumentsCell({ vendorId }: { vendorId: string })` — a table-cell-sized React component, consumed by `vendors/index.tsx` in Task 4.

- [ ] **Step 1: Write the component**

```tsx
// src/components/app/VendorDocumentsCell.tsx
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import { formatFileSize, validateDocumentFile } from "@/lib/vendor-documents";

const BUCKET = "vendor-documents";

export function VendorDocumentsCell({ vendorId }: { vendorId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryKey = ["vendor-documents", vendorId];

  const { data: documents, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error: fetchError } = await supabase
        .from("vendor_documents")
        .select("id, file_name, storage_path, file_size, created_at")
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
      for (const file of Array.from(files)) {
        const validation = validateDocumentFile({ name: file.name, size: file.size });
        if (!validation.valid) {
          rejected.push(`${file.name} (${validation.reason})`);
          continue;
        }
        const storagePath = `${uid}/${vendorId}/${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, { contentType: file.type || undefined });
        if (uploadError) throw uploadError;
        const { error: insertError } = await supabase.from("vendor_documents").insert({
          vendor_id: vendorId,
          owner_id: uid,
          file_name: file.name,
          storage_path: storagePath,
          file_size: file.size,
          content_type: file.type || null,
          uploaded_by: uid,
        });
        if (insertError) throw insertError;
      }
      if (rejected.length > 0) {
        setError(`Skipped: ${rejected.join(", ")}`);
      }
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      console.error("Failed to upload vendor document:", err);
      setError(getErrorMessage(err, "Could not upload the document"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(doc: VendorDocument) {
    setError(null);
    const { data, error: urlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (urlError || !data) {
      setError(getErrorMessage(urlError, "Could not open the document"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDelete(doc: VendorDocument) {
    setError(null);
    try {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([doc.storage_path]);
      if (removeError) throw removeError;
      const { error: deleteError } = await supabase.from("vendor_documents").delete().eq("id", doc.id);
      if (deleteError) throw deleteError;
      await queryClient.invalidateQueries({ queryKey });
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

  if (isLoading) {
    return <span className="text-muted-foreground">…</span>;
  }

  if (list.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">No document uploaded</span>
        {fileInput}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <Popover>
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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (This confirms `vendor_documents` types from Task 1 line up with the component's usage.)

- [ ] **Step 3: Commit**

```bash
git add src/components/app/VendorDocumentsCell.tsx
git commit -m "feat(vendors): add VendorDocumentsCell component"
```

---

### Task 4: Wire the Documents column into the vendors list

**Files:**
- Modify: `src/routes/_authenticated/vendors/index.tsx`

**Interfaces:**
- Consumes: `VendorDocumentsCell` from `src/components/app/VendorDocumentsCell.tsx` (Task 3).

- [ ] **Step 1: Import the component**

In `src/routes/_authenticated/vendors/index.tsx`, add the import alongside the existing component imports:

```typescript
import { VendorDocumentsCell } from "@/components/app/VendorDocumentsCell";
```

- [ ] **Step 2: Add the table header**

Add a new `<th>` after the existing "Status" header (`src/routes/_authenticated/vendors/index.tsx:100`):

```tsx
<th className="px-6 py-4">Status</th>
<th className="px-6 py-4">Documents</th>
```

- [ ] **Step 3: Add the table cell**

Add a new `<td>` after the existing Status cell (`src/routes/_authenticated/vendors/index.tsx:111-118`), inside the same `<tr>`:

```tsx
<td className="px-6 py-4">
  <VendorStatusBadge
    health={summary.healthByVendor.get(v.id) ?? "monitoring_issue"}
    failureReason={
      failureByVendor.has(v.id) ? describeFailure(failureByVendor.get(v.id)!) : undefined
    }
  />
</td>
<td className="px-6 py-4">
  <VendorDocumentsCell vendorId={v.id} />
</td>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, sign in, open `/vendors`.
Expected:
- Every vendor row shows "No document uploaded" with an upload button in the new Documents column.
- Clicking upload, selecting a valid file (e.g. a small PDF), shows a brief spinner, then the cell switches to "1 document".
- Clicking "1 document" opens a popover with the filename, size, and date; the download icon opens the file in a new tab; the trash icon removes it and the cell reverts to "No document uploaded".
- Selecting a disallowed file type (e.g. a `.zip`) shows an inline "Unsupported file type" error and does not upload.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including the new `vendor-documents.test.ts` suite.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/vendors/index.tsx
git commit -m "feat(vendors): show document status and upload in vendors list"
```
