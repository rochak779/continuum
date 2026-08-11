// src/integrations/document-extraction/extract-document-fields.server.ts
//
// Server-only: downloads a document from the private vendor-documents
// Storage bucket and asks Gemini to identify what the document is and
// when it expires. Best-effort — any failure (download, model call,
// malformed response) resolves to nulls rather than throwing, since
// extraction must never block the upload it's attached to.
//
// Only called for content types Gemini can read directly as a file part
// (PDF and common image types). Word/Excel uploads never reach this
// function — the caller skips it and leaves fields blank for manual entry.
//
// Uses the Google Generative AI API directly (not the Vercel AI Gateway) so
// this runs on Google's free tier — needs GOOGLE_GENERATIVE_AI_API_KEY.

import { google } from "@ai-sdk/google";
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
      model: google("gemini-3.5-flash"),
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
