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
