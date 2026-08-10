// Resolution controls for one alert (ERD §22 / chunk 13's resolveAlertFn):
// Verified/Accepted, False Positive, Risk Accepted/Exception. A reason is
// required for all three; owner and expiry are offered for Risk Accepted
// only, matching the backend's own validation in
// src/integrations/alerts/resolve-alert.ts.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resolveAlertFn } from "@/integrations/alerts/resolve-alert-fn";
import type { ResolutionType } from "@/integrations/alerts/types";

const RESOLUTION_OPTIONS: Array<{ value: ResolutionType; label: string; description: string }> = [
  {
    value: "verified_accepted",
    label: "Verified / Accepted",
    description: "Confirmed with the vendor or an independent source. Updates the Trust Profile.",
  },
  {
    value: "false_positive",
    label: "False Positive",
    description: "The detected change was incorrect or not applicable. Baseline is left unchanged.",
  },
  {
    value: "risk_accepted",
    label: "Risk Accepted / Exception",
    description: "Acknowledged and accepted as a known risk. Baseline is left unchanged.",
  },
];

interface AlertResolutionPanelProps {
  alertId: string;
  status: "open" | "investigating" | "resolved";
  actorId: string;
  onResolved: () => void;
}

export function AlertResolutionPanel({
  alertId,
  status,
  actorId,
  onResolved,
}: AlertResolutionPanelProps) {
  const [resolutionType, setResolutionType] = useState<ResolutionType>("verified_accepted");
  const [reason, setReason] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "resolved") {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h2 className="text-lg font-bold text-foreground">Resolution</h2>
        <p className="mt-2 text-sm text-muted-foreground">This alert has already been resolved.</p>
      </div>
    );
  }

  async function handleResolve() {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await resolveAlertFn({
        data: {
          alertId,
          resolutionType,
          reason: reason.trim(),
          actorId,
          ownerId:
            resolutionType === "risk_accepted" && ownerId.trim() ? ownerId.trim() : undefined,
          expiresAt:
            resolutionType === "risk_accepted" && expiresAt
              ? new Date(expiresAt).toISOString()
              : undefined,
        },
      });

      switch (outcome.status) {
        case "resolved":
          onResolved();
          return;
        case "already_resolved":
          setError("This alert was already resolved (possibly in another tab).");
          onResolved();
          return;
        case "not_found":
          setError("This alert could not be found.");
          return;
        case "invalid_input":
          setError(outcome.message);
          return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve this alert.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="text-lg font-bold text-foreground">Resolution</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every outcome is recorded with your identity, a timestamp, and the reason below.
      </p>

      <div className="mt-4 space-y-2">
        {RESOLUTION_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
              resolutionType === option.value
                ? "border-primary bg-accent"
                : "border-border hover:bg-surface-container-low"
            }`}
          >
            <input
              type="radio"
              name="resolutionType"
              value={option.value}
              checked={resolutionType === option.value}
              onChange={() => setResolutionType(option.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <Label htmlFor="resolution-reason">
          Reason <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="resolution-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Explain how this was verified, why it's a false positive, or why the risk is accepted…"
          className="bg-surface-container-low"
        />
      </div>

      {resolutionType === "risk_accepted" && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="resolution-owner">
              Owner{" "}
              <span className="font-normal text-muted-foreground">
                (optional — defaults to you)
              </span>
            </Label>
            <Input
              id="resolution-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="User ID of who owns this exception"
              className="h-11 bg-surface-container-low"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="resolution-expiry">
              Expiry date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="resolution-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-11 bg-surface-container-low"
            />
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end">
        <Button onClick={handleResolve} disabled={submitting}>
          {submitting ? "Resolving…" : "Resolve Alert"}
        </Button>
      </div>
    </div>
  );
}
