// api/extract-document-fields.ts
//
// Plain Vercel serverless function — deliberately NOT a TanStack Start
// server function, and deliberately not living under src/ or named
// `*.server.ts`. Bisection against real Vercel deploys showed that merely
// adding a new `*.server.ts` file under src/ — even one nothing imports
// yet — trips a circular-import bug in TanStack Start's own generated SSR
// chunks and crashes the whole app. Vercel builds `/api/*` with its own
// esbuild-based function bundler, entirely separate from the Nitro/Vite SSR
// build that has the bug, so keeping this file and its logic out of src/
// avoids it being scanned into that build at all.
//
// Downloads a document from the private vendor-documents Storage bucket
// and asks Gemini to identify what it is and when it expires. Best-effort —
// any failure (auth, download, model call, malformed response) resolves to
// nulls rather than a thrown error, since extraction must never block the
// upload it's attached to.
//
// Calls the Google Generative AI REST API directly with fetch (no `ai` SDK)
// so this runs on Google's free tier — needs GOOGLE_GENERATIVE_AI_API_KEY.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

import { normalizeExtractedDate } from "../src/integrations/document-extraction/normalize-extraction";

const BUCKET = "vendor-documents";
const EXTRACTABLE_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Mirrors the Zod schema this used to be described with — Gemini's REST API
// takes a plain JSON Schema for responseSchema.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    itemLabel: {
      type: ["string", "null"],
      description:
        'A short human-readable label for what kind of document this is, e.g. "Insurance Certificate", "Business License", "NDA". Null if it cannot be determined.',
    },
    expiryDate: {
      type: ["string", "null"],
      description:
        "The document's expiration/expiry date as an ISO date string (YYYY-MM-DD), if the document states one. Null if the document has no expiry date or none is stated. Do not confuse with an issue date, effective date, or signing date.",
    },
  },
  required: ["itemLabel", "expiryDate"],
};

interface ExtractedDocumentFields {
  itemLabel: string | null;
  expiryDate: string | null;
}

const NULL_RESULT: ExtractedDocumentFields = { itemLabel: null, expiryDate: null };

function isExtractableContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && EXTRACTABLE_CONTENT_TYPES.has(contentType));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function createSupabaseAdmin() {
  const SUPABASE_URL = process.env['SUPABASE_URL'];
  const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase environment variable(s): " +
        [!SUPABASE_URL && "SUPABASE_URL", !SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY"]
          .filter(Boolean)
          .join(", "),
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function extractDocumentFields(input: {
  storagePath: string;
  contentType: string;
}): Promise<ExtractedDocumentFields> {
  const apiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
  if (!apiKey) {
    console.error("[document-extraction] GOOGLE_GENERATIVE_AI_API_KEY is not set");
    return NULL_RESULT;
  }

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(input.storagePath);
    if (error || !data) {
      console.error("[document-extraction] Failed to download document:", error);
      return NULL_RESULT;
    }

    const bytes = new Uint8Array(await data.arrayBuffer());

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Identify what kind of document this is and, if stated, its expiry/expiration date. This is a vendor compliance document (e.g. insurance certificate, license, contract).",
              },
              {
                inlineData: {
                  mimeType: input.contentType,
                  data: bytesToBase64(bytes),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!response.ok) {
      console.error(
        "[document-extraction] Gemini API request failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return NULL_RESULT;
    }

    const body = await response.json();
    const text: string | undefined = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("[document-extraction] Gemini response had no text part:", JSON.stringify(body));
      return NULL_RESULT;
    }

    const parsed = JSON.parse(text) as { itemLabel?: unknown; expiryDate?: unknown };
    const itemLabel = typeof parsed.itemLabel === "string" ? parsed.itemLabel : null;
    const expiryDate =
      typeof parsed.expiryDate === "string" ? normalizeExtractedDate(parsed.expiryDate) : null;

    return { itemLabel, expiryDate };
  } catch (err) {
    console.error("[document-extraction] Extraction failed:", err);
    return NULL_RESULT;
  }
}

async function verifyCaller(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length);
  if (token.split(".").length !== 3) return false;

  const SUPABASE_URL = process.env['SUPABASE_URL'];
  const SUPABASE_PUBLISHABLE_KEY = process.env['SUPABASE_PUBLISHABLE_KEY'];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  return !error && Boolean(data?.claims?.sub);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authorized = await verifyCaller(req.headers.authorization);
  if (!authorized) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { storagePath, contentType } = (req.body ?? {}) as {
    storagePath?: unknown;
    contentType?: unknown;
  };

  if (typeof storagePath !== "string" || !storagePath) {
    res.status(400).json({ error: "storagePath is required" });
    return;
  }
  if (typeof contentType !== "string" || !isExtractableContentType(contentType)) {
    res.status(400).json({ error: "contentType must be a supported document type" });
    return;
  }

  const result = await extractDocumentFields({ storagePath, contentType });
  res.status(200).json(result);
}
