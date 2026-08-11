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

  const { data: documents, isLoading, isError } = useQuery({
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
      const failed: string[] = [];
      for (const file of Array.from(files)) {
        const validation = validateDocumentFile({ name: file.name, size: file.size });
        if (!validation.valid) {
          rejected.push(`${file.name} (${validation.reason})`);
          continue;
        }
        const storagePath = `${uid}/${vendorId}/${crypto.randomUUID()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, file.type ? { contentType: file.type } : {});
        if (uploadError) {
          failed.push(file.name);
          continue;
        }
        const { error: insertError } = await supabase.from("vendor_documents").insert({
          vendor_id: vendorId,
          owner_id: uid,
          file_name: file.name,
          storage_path: storagePath,
          file_size: file.size,
          content_type: file.type || null,
          uploaded_by: uid,
        });
        if (insertError) {
          failed.push(file.name);
          continue;
        }
      }
      const messages: string[] = [];
      if (rejected.length > 0) messages.push(`Skipped: ${rejected.join(", ")}`);
      if (failed.length > 0) messages.push(`Failed to upload: ${failed.join(", ")}`);
      if (messages.length > 0) setError(messages.join(" "));
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

  if (isLoading) {
    return <span className="text-muted-foreground">…</span>;
  }

  if (isError) {
    return <span className="text-xs text-destructive">Could not load documents</span>;
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
