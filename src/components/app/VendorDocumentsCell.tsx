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

  const anyExtracting = review.some((item) => item.extracting);

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
        <Button type="button" size="sm" disabled={saving || anyExtracting} onClick={handleSaveReview}>
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
