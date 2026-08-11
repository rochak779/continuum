# Document Expiry Extraction — Design

Date: 2026-08-11
Status: Approved

## Context

`VendorDocumentsCell` (`src/components/app/VendorDocumentsCell.tsx`) lets an
internal user upload documents for a vendor from the vendors list
(`src/routes/_authenticated/vendors/index.tsx`). It is the only document
upload path in the app. Uploaded files carry no metadata beyond file name,
size, and content type — there is no expiry date captured anywhere.

The dashboard (`src/routes/_authenticated/dashboard.tsx`) has an "Upcoming
Reviews & Expiries" panel that is currently a static placeholder
(`<PanelState>No upcoming reviews or expiries.</PanelState>`), wired to no
data source.

## Goal

When a user uploads a document for a vendor, extract (or let the user enter)
an expiry date and a short item label for that document, and surface
documents with upcoming expiry dates on the dashboard as: **Company name,
Item, Expiry date**.

## Non-goals

- Editing a confirmed `item_label`/`expiry_date` after it's saved. Deleting
  and re-uploading is the workaround — consistent with the existing
  no-versioning policy on vendor documents.
- Reminders or notifications for approaching expiries. Dashboard surfacing
  only for v1.
- AI expiry extraction for doc/docx/xls/xlsx files (Gemini cannot read
  these directly as documents the way it reads PDFs/images). These file
  types get manual-entry-only fields.
- Flagging or otherwise surfacing already-expired documents. The dashboard
  panel only shows documents whose expiry date is still in the future.
- Wiring up the "View All" action on the panel. It's a non-functional label
  today on every dashboard panel (Recent Material Changes, Actions
  Requiring Attention, etc.) — not new scope introduced by this feature.

## Design

### Data model

Add two nullable columns to the existing `vendor_documents` table
(migration, same RLS pattern as the rest of the table — no policy changes
needed since these are just additional columns readable/writable under the
existing `owner_id = auth.uid()` policies):

```sql
alter table public.vendor_documents
  add column item_label text,
  add column expiry_date date;
```

Both are nullable: a document may have no detectable/entered expiry (e.g.
an NDA), and `item_label` falls back to `file_name` for display when unset.

No "pending extraction" or "suggested" state is persisted. The AI's
suggestion lives only in transient client-side state until the user
confirms it (see Upload flow below) — the DB only ever holds
user-confirmed values, so there's no half-formed row to reconcile.

### Extraction (server-side)

New server function, following the existing `createServerFn` pattern used
by `src/integrations/alerts/resolve-alert-fn.ts`:

- `src/integrations/document-extraction/extract-document-fields-fn.ts` —
  the `createServerFn` wrapper: validates input (`storagePath`,
  `contentType`), dynamically imports the server-only implementation.
- `src/integrations/document-extraction/extract-document-fields.server.ts`
  — server-only implementation:
  - Downloads the file from the private `vendor-documents` Storage bucket
    via `supabaseAdmin` (service-role client never reaches the client
    bundle, same rule as `companies-house/provider.server.ts`).
  - Calls Google Gemini (`gemini-2.5-flash`) directly via `@ai-sdk/google`
    (Google's free-tier API, not the Vercel AI Gateway — switched from an
    earlier Claude/Gateway draft to avoid Gateway usage costs) using the
    `ai` package's `generateText`/`Output.object`, passing the file as a
    document/image content part and a zod schema:
    ```ts
    z.object({
      itemLabel: z.string().nullable(),
      expiryDate: z.string().nullable(), // ISO date (YYYY-MM-DD) or null
    })
    ```
  - Only invoked for `content_type` in `application/pdf`, `image/png`,
    `image/jpeg` — the caller (review UI) skips calling this function
    entirely for doc/docx/xls/xlsx.
  - On any failure (model/network error, malformed response, no date
    found) returns `{ itemLabel: null, expiryDate: null }` rather than
    throwing — extraction is best-effort and must never block upload.
- `src/integrations/document-extraction/normalize-extraction.ts` — pure,
  unit-testable helper that coerces the model's raw `expiryDate` string
  into a valid ISO date or `null` (rejects malformed/unparseable dates
  rather than passing them through).

### Upload → confirm flow (`VendorDocumentsCell`)

Splits the current single-step upload into two steps:

1. **Upload** (mostly unchanged): selected files are validated
   (`validateDocumentFile`) and pushed to Storage immediately, same as
   today. No `vendor_documents` row is inserted yet.
2. **Review** (new): the popover shows a review list, one row per
   just-uploaded file, each with editable **Item** (text input) and
   **Expiry date** (`<input type="date">`) fields.
   - For PDF/image files: `extractDocumentFieldsFn` is called per file in
     parallel; each row shows a small loading spinner until its call
     settles, then pre-fills Item/Expiry from the result (either field may
     come back empty).
   - For doc/docx/xls/xlsx files: no extraction call is made; both fields
     start blank for manual entry.
   - The user may edit or clear any field before saving.
3. **Save** (single action, all rows at once): inserts one
   `vendor_documents` row per reviewed file with `item_label`/`expiry_date`
   set to whatever is currently in that row's fields (including blank →
   `null`). This is the point the document becomes visible in the "N
   documents" list. Query invalidation follows the existing pattern.
4. **Discard**: removes the just-uploaded Storage objects and clears
   review state — no DB rows written.

If the user closes the popover mid-review without Save or Discard, the
uploaded Storage objects are abandoned (orphaned, uncleaned) — the same
accepted edge case as the existing partial-delete-failure case documented
in the vendor-documents spec; not worth extra machinery for v1.

The existing document list (post-save) gains no new UI beyond what's
needed to display the confirmed values — expiry date is not shown inline
in the popover list for v1 (it surfaces on the dashboard instead); this
keeps the popover list unchanged from its current shape.

### Dashboard panel — "Upcoming Reviews & Expiries"

- `dashboard.tsx`'s existing `Promise.all` gains one more query:
  `vendor_documents` rows where `expiry_date >= today`, `select id,
  vendor_id, item_label, file_name, expiry_date`, ordered by `expiry_date`
  ascending, `limit(5)` — matching the cap already used for Recent Material
  Changes / Actions Requiring Attention.
- New pure helper in `src/lib/dashboard-data.ts`:
  `buildUpcomingExpiries(documents, vendorNames)` — joins each document's
  `vendor_id` to its `company_name` (reusing the same `Map<string,
  string>` pattern already built for `vendorNames` in `dashboard.tsx`),
  and falls back to `file_name` when `item_label` is null. Returns rows
  already sorted by expiry date (defensive re-sort in case callers pass
  unsorted data). Unit-tested alongside the other helpers in
  `dashboard-data.test.ts`.
- Panel renders each row as **Company** | **Item** | **Expiry date**
  (e.g. "Jan 15, 2027"), same visual style/spacing as the other panels'
  row lists (`Recent Material Changes`).
- Empty state (`No upcoming reviews or expiries.`) stays as-is when the
  list is empty.

### Error handling / UX

- Extraction failures never surface as errors to the user — the review row
  just keeps its fields blank/editable, same as the doc/docx/xls/xlsx
  no-extraction case. No distinct "extraction failed" messaging.
- Save/Discard failures (network, RLS) surface the existing inline error
  pattern already used elsewhere in `VendorDocumentsCell` (`setError` +
  inline destructive text).
- Manual date entry relies on the native `<input type="date">` for format
  validation — no additional validation layer.

### Testing

Consistent with this codebase's existing pattern (logic-only `*.test.ts`,
no React component tests, no tests hitting the live AI call — same
convention as not testing live Companies House calls):

- `normalize-extraction.ts`: valid ISO date passthrough, malformed/garbage
  date → `null`, `null` input → `null`.
- `buildUpcomingExpiries` in `dashboard-data.test.ts`: company name join,
  `item_label` vs `file_name` fallback, sort order, exclusion of
  past-due/null-expiry documents (defensive — the DB query already filters
  these, but the helper shouldn't assume it received pre-filtered input).

## Open questions / follow-ups (not part of this spec)

- Editing a confirmed expiry date/item label after save.
- Reminder notifications as expiry dates approach.
- Surfacing/flagging already-expired documents somewhere (compliance view,
  vendor detail, etc.).
- AI extraction support for doc/docx/xls/xlsx (would need a conversion
  step, e.g. extracting text before sending to the model).
