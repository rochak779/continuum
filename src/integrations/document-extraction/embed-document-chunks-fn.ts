// TanStack Start server function wrapper around embedAndStoreDocumentChunks.
// Called by VendorDocumentsCell right after a document row is saved to
// vendor_documents (so vendorDocumentId exists). Auth is enforced by
// requireSupabaseAuth; ownerId is always context.userId, never taken from
// client input.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface EmbedDocumentChunksFnInput {
  vendorDocumentId: string;
  vendorId: string;
  extractedText: string;
}

function validateInput(input: EmbedDocumentChunksFnInput): EmbedDocumentChunksFnInput {
  if (!input || typeof input.vendorDocumentId !== "string" || !input.vendorDocumentId) {
    throw new Error("vendorDocumentId is required");
  }
  if (typeof input.vendorId !== "string" || !input.vendorId) {
    throw new Error("vendorId is required");
  }
  if (typeof input.extractedText !== "string") {
    throw new Error("extractedText is required");
  }
  return input;
}

export const embedDocumentChunksFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateInput)
  .handler(async ({ data, context }) => {
    const { embedAndStoreDocumentChunks } = await import("./embed-and-store-chunks.server");
    return embedAndStoreDocumentChunks(context.supabase, {
      vendorDocumentId: data.vendorDocumentId,
      vendorId: data.vendorId,
      ownerId: context.userId,
      extractedText: data.extractedText,
    });
  });
