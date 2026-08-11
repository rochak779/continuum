import { AlertTriangle } from "lucide-react";

import { VENDOR_HEALTH_LABELS, type VendorHealth } from "@/lib/vendor-health";

export function VendorStatusBadge({
  health,
  failureReason,
}: {
  health: VendorHealth;
  failureReason?: string | undefined;
}) {
  const label = VENDOR_HEALTH_LABELS[health];

  if (health !== "monitoring_issue" || !failureReason) {
    return <span className="text-muted-foreground">{label}</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground"
      title={failureReason}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      {label}
    </span>
  );
}
