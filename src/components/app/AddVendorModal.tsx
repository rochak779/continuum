import { useNavigate } from "@tanstack/react-router";
import { Store, PlugZap, FileUp, FilePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  hideUpload?: boolean;
}

export function AddVendorModal({ isOpen, onClose, hideUpload }: AddVendorModalProps) {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const options = [];

  options.push({
    id: "erp",
    icon: <PlugZap className="h-6 w-6" />,
    title: "Connect your ERP",
    description:
      "Sync automatically with SAP, Oracle, NetSuite, and other major enterprise systems.",
    badge: "Coming soon",
    disabled: true,
    onClick: () => {},
  });

  if (!hideUpload) {
    options.push({
      id: "upload",
      icon: <FileUp className="h-6 w-6" />,
      title: "Add vendors by uploading a file",
      description: "Import via CSV or Excel. Download our template for seamless mapping.",
      onClick: () => navigate({ to: "/vendors/upload" }),
    });
  }

  options.push({
    id: "manual",
    icon: <FilePen className="h-6 w-6" />,
    title: "Add vendors manually",
    description:
      "Enter details one by one using our structured intake form for strict data control.",
    onClick: () => navigate({ to: "/vendors/new" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div className="w-full max-w-[1120px] overflow-hidden rounded-2xl bg-card shadow-elevated">
        <div className="flex items-start gap-4 border-b border-border px-8 py-7">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary">
            <Store className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Add your vendors
            </h2>
            <p className="mt-1 text-muted-foreground">
              Choose how you'd like to import vendor data into Continuum.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="grid gap-6 bg-background px-8 py-8 md:grid-cols-3">
          {options.map((option) => (
            <OptionCard key={option.id} {...option} />
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border px-8 py-5">
          <p className="text-sm text-muted-foreground">
            Need help?{" "}
            <a href="#" className="font-medium text-primary hover:underline">
              View import documentation
            </a>
          </p>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function OptionCard({
  icon,
  title,
  description,
  badge,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string | undefined;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-full flex-col rounded-2xl border border-border bg-card p-6 text-left shadow-card transition-shadow hover:shadow-elevated disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-card"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
        {icon}
      </span>
      <h3 className="mt-6 text-xl font-bold text-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{description}</p>
      {badge && (
        <span className="mt-4 inline-flex w-fit rounded-full bg-warning-container px-3 py-1 text-xs font-semibold text-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
