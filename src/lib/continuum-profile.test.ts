import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureContinuumProfile,
  profileRowFromSignupMetadata,
  resetEnsuredProfilesForTests,
  type ProfileClient,
} from "./continuum-profile";

const SIGNUP_METADATA = {
  continuum: {
    full_name: "Ada Lovelace",
    organization_name: "Analytical Engines Ltd",
    country: "United Kingdom",
    industry: "Technology",
    company_size: "11-50",
    phone: "+44 7700 900123",
    designation: "CTO",
    team_invites: [{ email: "babbage@example.com", role: "Admin" }],
  },
};

describe("profileRowFromSignupMetadata", () => {
  it("maps the signup wizard's metadata onto a profiles row", () => {
    expect(profileRowFromSignupMetadata("user-1", SIGNUP_METADATA)).toEqual({
      id: "user-1",
      full_name: "Ada Lovelace",
      organization_name: "Analytical Engines Ltd",
      country: "United Kingdom",
      industry: "Technology",
      company_size: "11-50",
      phone: "+44 7700 900123",
      designation: "CTO",
    });
  });

  it("ignores other apps' top-level metadata in the shared auth.users", () => {
    const row = profileRowFromSignupMetadata("user-1", {
      full_name: "Set by another app",
      marg: { first_name: "Ada" },
    });
    expect(row).toEqual({
      id: "user-1",
      full_name: null,
      organization_name: null,
      country: null,
      industry: null,
      company_size: null,
      phone: null,
      designation: null,
    });
  });

  it("treats missing or malformed metadata as empty", () => {
    expect(profileRowFromSignupMetadata("user-1", undefined).full_name).toBeNull();
    expect(profileRowFromSignupMetadata("user-1", { continuum: "nope" }).full_name).toBeNull();
    expect(
      profileRowFromSignupMetadata("user-1", { continuum: { full_name: 42 } }).full_name,
    ).toBeNull();
  });
});

type Result = { data: unknown; error: { message: string } | null };

function fakeClient(results: { profiles: Result; team_invites?: Result }) {
  const calls: { table: string; op: string; payload: unknown; options?: unknown }[] = [];
  const client = {
    from(table: "profiles" | "team_invites") {
      return {
        upsert(payload: unknown, options: unknown) {
          calls.push({ table, op: "upsert", payload, options });
          return { select: () => Promise.resolve(results.profiles) };
        },
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload });
          return Promise.resolve(results.team_invites ?? { data: null, error: null });
        },
      };
    },
  };
  return { client: client as unknown as ProfileClient, calls };
}

describe("ensureContinuumProfile", () => {
  beforeEach(() => {
    resetEnsuredProfilesForTests();
    vi.restoreAllMocks();
  });

  it("creates the profile without overwriting an existing one", async () => {
    const { client, calls } = fakeClient({ profiles: { data: [{ id: "user-1" }], error: null } });
    await ensureContinuumProfile(client, { id: "user-1", user_metadata: SIGNUP_METADATA });

    expect(calls[0]).toMatchObject({
      table: "profiles",
      op: "upsert",
      payload: { id: "user-1", full_name: "Ada Lovelace" },
      options: { onConflict: "id", ignoreDuplicates: true },
    });
  });

  it("sends the signup wizard's team invites only when the profile is new", async () => {
    const { client, calls } = fakeClient({ profiles: { data: [{ id: "user-1" }], error: null } });
    await ensureContinuumProfile(client, { id: "user-1", user_metadata: SIGNUP_METADATA });

    expect(calls[1]).toEqual({
      table: "team_invites",
      op: "insert",
      payload: [{ inviter_id: "user-1", email: "babbage@example.com", role: "Admin" }],
    });
  });

  it("does not resend invites when the profile already existed", async () => {
    const { client, calls } = fakeClient({ profiles: { data: [], error: null } });
    await ensureContinuumProfile(client, { id: "user-1", user_metadata: SIGNUP_METADATA });

    expect(calls.map((c) => c.table)).toEqual(["profiles"]);
  });

  it("only checks once per user per page load", async () => {
    const { client, calls } = fakeClient({ profiles: { data: [], error: null } });
    await ensureContinuumProfile(client, { id: "user-1", user_metadata: SIGNUP_METADATA });
    await ensureContinuumProfile(client, { id: "user-1", user_metadata: SIGNUP_METADATA });

    expect(calls).toHaveLength(1);
  });

  it("logs instead of throwing on failure, and retries on the next call", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = fakeClient({ profiles: { data: null, error: { message: "boom" } } });
    await expect(
      ensureContinuumProfile(failing.client, { id: "user-1", user_metadata: SIGNUP_METADATA }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    const working = fakeClient({ profiles: { data: [], error: null } });
    await ensureContinuumProfile(working.client, { id: "user-1", user_metadata: SIGNUP_METADATA });
    expect(working.calls).toHaveLength(1);
  });
});
