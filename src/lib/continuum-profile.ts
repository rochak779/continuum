// Creates the signed-in user's continuum.profiles row on first sign-in.
//
// auth.users is shared with other apps in the same Supabase project (see
// docs/shared-supabase-db.md), so there is no database trigger on it.
// Instead, signup.tsx stores the wizard's answers under the `continuum` key
// of the user's metadata, and this runs from the /_authenticated route the
// first time the user reaches the app. It also covers people who already
// have an account from another app: they get an empty profile, not an error.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type ProfileInsert = Database["continuum"]["Tables"]["profiles"]["Insert"];

export type ProfileClient = Pick<SupabaseClient<Database, "continuum">, "from">;

const PROFILE_FIELDS = [
  "full_name",
  "organization_name",
  "country",
  "industry",
  "company_size",
  "phone",
  "designation",
] as const;

type ProfileFields = Pick<ProfileInsert, (typeof PROFILE_FIELDS)[number]>;

type TeamInvite = { email: string; role: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function continuumMetadata(userMetadata: unknown): Record<string, unknown> {
  if (!isRecord(userMetadata)) return {};
  const ours = userMetadata["continuum"];
  return isRecord(ours) ? ours : {};
}

export function profileRowFromSignupMetadata(
  userId: string,
  userMetadata: unknown,
): ProfileFields & { id: string } {
  const meta = continuumMetadata(userMetadata);
  const row: ProfileFields & { id: string } = { id: userId };
  for (const field of PROFILE_FIELDS) {
    const value = meta[field];
    row[field] = typeof value === "string" ? value : null;
  }
  return row;
}

function teamInvitesFromSignupMetadata(userMetadata: unknown): TeamInvite[] {
  const invites = continuumMetadata(userMetadata)["team_invites"];
  if (!Array.isArray(invites)) return [];
  return invites.filter(
    (i): i is TeamInvite =>
      isRecord(i) && typeof i["email"] === "string" && typeof i["role"] === "string",
  );
}

// Once a user's profile is known to exist, skip the round trip on later
// navigations within the same page load.
const ensuredUserIds = new Set<string>();

export function resetEnsuredProfilesForTests() {
  ensuredUserIds.clear();
}

export async function ensureContinuumProfile(
  client: ProfileClient,
  user: { id: string; user_metadata?: unknown },
): Promise<void> {
  if (ensuredUserIds.has(user.id)) return;

  // ignoreDuplicates makes this INSERT ... ON CONFLICT DO NOTHING, so an
  // existing profile is never overwritten and `data` holds only new rows.
  const { data: created, error } = await client
    .from("profiles")
    .upsert(profileRowFromSignupMetadata(user.id, user.user_metadata), {
      onConflict: "id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    // Don't block entry to the app; the next navigation retries.
    console.error("Could not create the Continuum profile", { message: error.message });
    return;
  }
  ensuredUserIds.add(user.id);

  const invites = teamInvitesFromSignupMetadata(user.user_metadata);
  if (created && created.length > 0 && invites.length > 0) {
    const { error: inviteError } = await client
      .from("team_invites")
      .insert(invites.map((i) => ({ inviter_id: user.id, email: i.email, role: i.role })));
    if (inviteError) {
      console.error("Could not save signup team invites", { message: inviteError.message });
    }
  }
}
