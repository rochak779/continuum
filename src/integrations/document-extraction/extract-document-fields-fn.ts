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
