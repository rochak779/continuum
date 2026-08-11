# Account Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user view and edit the profile information captured at signup, from a real `/settings` page reachable from the sidebar.

**Architecture:** A pure helper module (`src/lib/profile-settings.ts`) holds the one piece of non-trivial logic — converting between the single stored `phone` string and the dial-code/number pair the form uses — plus the validation schema, reused from the signup wizard's schemas via `.omit()`. A new route component (`src/routes/_authenticated/settings.tsx`) loads the current user's `profiles` row with `useQuery`, renders it in an editable form matching the existing `vendors/new.tsx` form style, and saves via a direct `supabase.from("profiles").update()` call, mirroring that same file's submit pattern. `AppShell.tsx` gets a one-line change to make the existing "Settings" sidebar entry a real link.

**Tech Stack:** React, TanStack Router (file-based routes, `routeTree.gen.ts` auto-generated), TanStack Query, Supabase JS client, Zod, existing `src/components/ui/*` primitives (Button, Input, Label, Select), Vitest.

## Global Constraints

- No database schema or RLS changes — reuse `public.profiles` and its existing "Users can view/update their own profile" policies (`auth.uid() = id`).
- Editable fields: `full_name`, `organization_name`, `country`, `industry`, `company_size`, `phone` (as dial code + number), `designation`. Email is displayed read-only with a note that changing it isn't supported here yet. No password field.
- `primary_currency` and `time_zone` columns exist on `profiles` but were never part of the signup flow — do not surface them on this page.
- Validation must reuse `organizationSchema` and `detailsSchema` from `src/components/signup/wizard.ts` (via `.omit()` for the settings-only variant), not duplicate the rules.
- Testing pattern: logic-only `*.test.ts` files (Vitest, `describe`/`it`/`expect` from `"vitest"`), matching every other file in `src/lib/*.test.ts`. No React component tests exist anywhere in this repo — don't add the first one here.

---

### Task 1: Profile settings helpers — phone conversion + validation schema

**Files:**
- Create: `src/lib/profile-settings.ts`
- Test: `src/lib/profile-settings.test.ts`

**Interfaces:**
- Consumes: `DIAL_CODES: { code: string; dial: string }[]`, `organizationSchema`, `detailsSchema` from `src/components/signup/wizard.ts` (all already exported there).
- Produces (used by Task 2):
  - `splitStoredPhone(stored: string | null): { dialCode: string; phone: string }`
  - `joinPhoneForStorage(dialCode: string, phone: string): string`
  - `profileDetailsSchema` — Zod schema, `z.infer` yields `{ fullName: string; dialCode: string; phone: string; designation: string }`
  - `profileOrganizationSchema` — re-export of `organizationSchema`, `z.infer` yields `{ organizationName: string; country: string; industry: string; companySize: string }`
  - `type ProfileDetailsData = z.infer<typeof profileDetailsSchema>`
  - `type ProfileOrganizationData = z.infer<typeof profileOrganizationSchema>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/profile-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { joinPhoneForStorage, splitStoredPhone } from "./profile-settings";

describe("splitStoredPhone", () => {
  it("returns an empty phone and the default dial code for null", () => {
    expect(splitStoredPhone(null)).toEqual({ dialCode: "+1", phone: "" });
  });

  it("returns an empty phone and the default dial code for an empty string", () => {
    expect(splitStoredPhone("")).toEqual({ dialCode: "+1", phone: "" });
  });

  it("splits a recognised dial code from the rest of the number", () => {
    expect(splitStoredPhone("+91 9876543210")).toEqual({
      dialCode: "+91",
      phone: "9876543210",
    });
  });

  it("keeps internal spaces in the number intact", () => {
    expect(splitStoredPhone("+1 415 555 0100")).toEqual({
      dialCode: "+1",
      phone: "415 555 0100",
    });
  });

  it("falls back to the default dial code when the prefix isn't a known dial code", () => {
    expect(splitStoredPhone("07123 456789")).toEqual({
      dialCode: "+1",
      phone: "07123 456789",
    });
  });
});

describe("joinPhoneForStorage", () => {
  it("joins a dial code and number with a space", () => {
    expect(joinPhoneForStorage("+91", "9876543210")).toBe("+91 9876543210");
  });

  it("trims the number before joining", () => {
    expect(joinPhoneForStorage("+1", "  415 555 0100  ")).toBe("+1 415 555 0100");
  });

  it("returns an empty string when the number is blank", () => {
    expect(joinPhoneForStorage("+1", "   ")).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/lib/profile-settings.test.ts`
Expected: FAIL — `Cannot find module './profile-settings'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/profile-settings.ts`:

```ts
// Helpers for the account settings page (src/routes/_authenticated/settings.tsx).
//
// `profiles.phone` is stored as a single "<dialCode> <number>" string (the
// same format signup.tsx builds when creating the account). The settings
// form edits dial code and number as two separate fields, so this module
// is the one place that converts between the two shapes.

import { z } from "zod";

import { DIAL_CODES, detailsSchema, organizationSchema } from "@/components/signup/wizard";

const DEFAULT_DIAL_CODE = DIAL_CODES[0].dial;

/**
 * Splits a stored "<dialCode> <number>" phone string back into the two
 * fields the form uses. Falls back to the default dial code with the raw
 * string as the number when the stored value is empty or doesn't start
 * with a dial code we recognise (e.g. it was never set, or was written by
 * something other than this form).
 */
export function splitStoredPhone(stored: string | null): { dialCode: string; phone: string } {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return { dialCode: DEFAULT_DIAL_CODE, phone: "" };

  const [maybeDial, ...rest] = trimmed.split(" ");
  const knownDial = DIAL_CODES.find((d) => d.dial === maybeDial);
  if (knownDial && rest.length > 0) {
    return { dialCode: knownDial.dial, phone: rest.join(" ").trim() };
  }
  return { dialCode: DEFAULT_DIAL_CODE, phone: trimmed };
}

/** Joins a dial code and number back into the stored phone format. */
export function joinPhoneForStorage(dialCode: string, phone: string): string {
  const trimmedPhone = phone.trim();
  return trimmedPhone ? `${dialCode} ${trimmedPhone}` : "";
}

// Same validation rules as signup's "Your Details" step, minus the fields
// this page doesn't edit (email, password).
export const profileDetailsSchema = detailsSchema.omit({ email: true, password: true });

// Re-exported under this module's naming so settings.tsx has one import
// source for both settings schemas.
export const profileOrganizationSchema = organizationSchema;

export type ProfileDetailsData = z.infer<typeof profileDetailsSchema>;
export type ProfileOrganizationData = z.infer<typeof profileOrganizationSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test src/lib/profile-settings.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile-settings.ts src/lib/profile-settings.test.ts
git commit -m "feat(settings): add profile phone conversion and validation helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Settings route — load, edit, save profile; wire up sidebar link

**Files:**
- Create: `src/routes/_authenticated/settings.tsx`
- Modify: `src/components/app/AppShell.tsx:17-27`
- Modify (auto-generated, see Step 6): `src/routeTree.gen.ts`

**Interfaces:**
- Consumes from Task 1: `splitStoredPhone`, `joinPhoneForStorage`, `profileDetailsSchema`, `profileOrganizationSchema`, `ProfileDetailsData`, `ProfileOrganizationData` from `@/lib/profile-settings`.
- Consumes existing: `DIAL_CODES`, `COUNTRIES`, `INDUSTRIES`, `COMPANY_SIZES`, `DESIGNATIONS` from `@/components/signup/wizard`; `getErrorMessage` from `@/lib/errors`; `supabase` from `@/integrations/supabase/client`; `AppShell` from `@/components/app/AppShell`; `Button`, `Input`, `Label`, `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` from `@/components/ui/*`.
- Produces: the `/settings` route, and a real (non-dead) "Settings" sidebar link. Nothing else depends on this task.

This task has no automated test of its own (per the Global Constraints — no component tests exist in this repo). Verification is manual, via `bun run dev` and `bun run build`, at the end of the task.

- [ ] **Step 1: Add the Settings route to the sidebar**

In `src/components/app/AppShell.tsx`, move `Settings` from `staticItems` into `navItems` so it's a real link instead of a dead button:

```ts
const navItems = [
  { label: "Dashboard", icon: LayoutGrid, to: "/dashboard" as const },
  { label: "Vendors", icon: Users, to: "/vendors" as const },
  { label: "Alerts", icon: Bell, to: "/alerts" as const },
  { label: "Settings", icon: Settings, to: "/settings" as const },
];

const staticItems = [
  { label: "Monitoring", icon: Eye },
  { label: "Reports", icon: BarChart3 },
];
```

(`Settings` icon import from `lucide-react` is already present at the top of the file — no import changes needed.)

- [ ] **Step 2: Create the settings route component**

Create `src/routes/_authenticated/settings.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errors";
import {
  joinPhoneForStorage,
  profileDetailsSchema,
  profileOrganizationSchema,
  splitStoredPhone,
} from "@/lib/profile-settings";
import {
  COMPANY_SIZES,
  COUNTRIES,
  DESIGNATIONS,
  DIAL_CODES,
  INDUSTRIES,
} from "@/components/signup/wizard";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Account Settings | Continuum" },
      {
        name: "description",
        content: "View and update your Continuum account and organisation details.",
      },
    ],
  }),
  component: SettingsPage,
});

interface SettingsForm {
  fullName: string;
  dialCode: string;
  phone: string;
  designation: string;
  organizationName: string;
  country: string;
  industry: string;
  companySize: string;
}

const emptyForm: SettingsForm = {
  fullName: "",
  dialCode: DIAL_CODES[0].dial,
  phone: "",
  designation: "",
  organizationName: "",
  country: "",
  industry: "",
  companySize: "",
};

function SettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(emptyForm);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "profile"],
    queryFn: async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(
          "full_name, phone, designation, organization_name, country, industry, company_size",
        )
        .eq("id", uid)
        .single();
      if (profileError) throw profileError;

      return { email: userData.user?.email ?? "", profile };
    },
  });

  useEffect(() => {
    if (!data) return;
    const { dialCode, phone } = splitStoredPhone(data.profile.phone);
    setForm({
      fullName: data.profile.full_name ?? "",
      dialCode,
      phone,
      designation: data.profile.designation ?? "",
      organizationName: data.profile.organization_name ?? "",
      country: data.profile.country ?? "",
      industry: data.profile.industry ?? "",
      companySize: data.profile.company_size ?? "",
    });
    setEmail(data.email);
  }, [data]);

  const set = (patch: Partial<SettingsForm>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const detailsParsed = profileDetailsSchema.safeParse({
      fullName: form.fullName,
      dialCode: form.dialCode,
      phone: form.phone,
      designation: form.designation,
    });
    if (!detailsParsed.success) {
      setError(detailsParsed.error.issues[0]?.message ?? "Please check your details");
      return;
    }
    const orgParsed = profileOrganizationSchema.safeParse({
      organizationName: form.organizationName,
      country: form.country,
      industry: form.industry,
      companySize: form.companySize,
    });
    if (!orgParsed.success) {
      setError(orgParsed.error.issues[0]?.message ?? "Please check your organisation details");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) throw new Error("You need to be signed in");

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: detailsParsed.data.fullName,
          phone: joinPhoneForStorage(detailsParsed.data.dialCode, detailsParsed.data.phone),
          designation: detailsParsed.data.designation,
          organization_name: orgParsed.data.organizationName,
          country: orgParsed.data.country,
          industry: orgParsed.data.industry,
          company_size: orgParsed.data.companySize,
        })
        .eq("id", uid);
      if (updateError) throw updateError;

      await queryClient.invalidateQueries({ queryKey: ["settings", "profile"] });
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, "Could not save your changes"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Account Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          View and update the details you gave us when you set up Continuum.
        </p>

        {isLoading && (
          <p className="mt-8 text-sm text-muted-foreground">Loading your details…</p>
        )}
        {isError && (
          <p className="mt-8 text-sm font-medium text-destructive">
            Couldn't load your account details. Try refreshing the page.
          </p>
        )}

        {!isLoading && !isError && (
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-card"
          >
            <h2 className="text-xl font-bold text-foreground">Your Details</h2>

            <div className="mt-6 space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} disabled className="h-12 bg-surface-container-low" />
              <p className="text-xs text-muted-foreground">
                Contact support to change your login email.
              </p>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => set({ fullName: e.target.value })}
                  className="h-12 bg-surface-container-low"
                />
              </div>

              <SelectField
                label="Designation"
                placeholder="Select designation"
                options={DESIGNATIONS}
                value={form.designation}
                onChange={(v) => set({ designation: v })}
              />

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="phone">Phone</Label>
                <div className="flex gap-2">
                  <Select value={form.dialCode} onValueChange={(v) => set({ dialCode: v })}>
                    <SelectTrigger className="h-12 w-28 bg-surface-container-low">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAL_CODES.map((d) => (
                        <SelectItem key={d.code} value={d.dial}>
                          {d.dial}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => set({ phone: e.target.value })}
                    className="h-12 flex-1 bg-surface-container-low"
                  />
                </div>
              </div>
            </div>

            <h2 className="mt-10 border-t border-border pt-8 text-xl font-bold text-foreground">
              Your Organisation
            </h2>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="organizationName">Organisation Name</Label>
                <Input
                  id="organizationName"
                  value={form.organizationName}
                  onChange={(e) => set({ organizationName: e.target.value })}
                  className="h-12 bg-surface-container-low"
                />
              </div>

              <SelectField
                label="Country"
                placeholder="Select country"
                options={COUNTRIES}
                value={form.country}
                onChange={(v) => set({ country: v })}
              />
              <SelectField
                label="Industry"
                placeholder="Select industry"
                options={INDUSTRIES}
                value={form.industry}
                onChange={(v) => set({ industry: v })}
              />
              <SelectField
                label="Company Size"
                placeholder="Select company size"
                options={COMPANY_SIZES}
                value={form.companySize}
                onChange={(v) => set({ companySize: v })}
              />
            </div>

            {error && <p className="mt-6 text-sm font-medium text-destructive">{error}</p>}
            {saved && !error && (
              <p className="mt-6 text-sm font-medium text-success">Saved.</p>
            )}

            <div className="mt-8 flex justify-end gap-3 border-t border-border pt-6">
              <Button type="submit" disabled={saving} className="px-6">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}

function SelectField({
  label,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-12 w-full bg-surface-container-low">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 3: Regenerate the route tree**

`src/routeTree.gen.ts` is auto-generated by the TanStack Router Vite plugin and is checked into git, so the new `/settings` route needs to be picked up.

Run: `bun run dev`

Wait for the dev server to print its ready message (it regenerates `routeTree.gen.ts` on startup and on new route files), then stop it (Ctrl-C).

- [ ] **Step 4: Verify the route tree picked up the new route**

Run: `grep -n "SettingsRoute" src/routeTree.gen.ts`
Expected: matches showing a `SettingsRoute` entry wired into `AuthenticatedRouteRouteChildren` and `FileRoutesByFullPath`/`FileRoutesById` etc. If there's no match, re-run `bun run dev` and check the terminal output for a route-generation error before continuing.

- [ ] **Step 5: Run the full test suite**

Run: `bun run test`
Expected: PASS — all existing tests plus the 8 new ones from Task 1 still green (this task adds no new automated tests).

- [ ] **Step 6: Type-check and build**

Run: `bun run build`
Expected: succeeds with no TypeScript errors. This is the closest thing this repo has to a compile-time check that `settings.tsx`'s Supabase query/update shapes match the generated `profiles` types in `src/integrations/supabase/types.ts`.

- [ ] **Step 7: Manual smoke test**

Run: `bun run dev`, open the app, log in, click "Settings" in the sidebar.

Confirm:
- The page loads with your email (read-only) and the profile fields pre-filled from signup.
- Editing a field (e.g. Full Name) and clicking "Save Changes" shows "Saved." and the change persists on page refresh.
- Leaving a required field blank (e.g. clearing Organisation Name) and saving shows an inline validation error instead of a silent failure.

Stop the dev server (Ctrl-C) once confirmed.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authenticated/settings.tsx src/components/app/AppShell.tsx src/routeTree.gen.ts
git commit -m "feat(settings): add account settings page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review Notes

- **Spec coverage:** route + nav link (Task 2, Steps 1–2), profile load (Task 2 Step 2 `useQuery`), editable fields matching the spec's field list exactly, email read-only with the note from the spec, phone stored/split per the spec's documented format, validation reusing signup schemas (Task 1), loading/error/save states (Task 2), no automated component test / logic extracted and tested instead (Task 1) — all covered.
- **Placeholder scan:** none — every step has complete code, no TBDs.
- **Type consistency:** `splitStoredPhone`/`joinPhoneForStorage` signatures match between Task 1's definition and Task 2's usage; `ProfileDetailsData`/`ProfileOrganizationData` types aren't directly imported by name in Task 2 (Task 2 builds its own local `SettingsForm` shape and calls `.safeParse` against plain objects), which is intentional — the form's field names (`fullName`, `dialCode`, etc.) match `profileDetailsSchema`'s shape exactly, so `safeParse` validates correctly.
