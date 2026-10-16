import type { SupabaseClient } from "@supabase/supabase-js";

// For modules that are untyped on purpose (they query tables the generated
// Database type doesn't describe). A bare `SupabaseClient` defaults to the
// `public` schema, which Continuum's clients no longer use: its tables live
// in `continuum` (docs/shared-supabase-db.md).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UntypedSupabaseClient = SupabaseClient<any, "continuum">;
