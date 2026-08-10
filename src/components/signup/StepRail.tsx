import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STEPS } from "./wizard";

export function StepRail({ current }: { current: number }) {
  return (
    <ol className="space-y-0">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step.short} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-surface-container-lowest",
                  !done && !active && "border-border bg-surface-container-lowest",
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : (
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      active ? "bg-primary" : "bg-transparent",
                    )}
                  />
                )}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  className={cn(
                    "my-1 w-0.5 flex-1 rounded-full",
                    done ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </div>
            <div className={cn("pb-8", index === STEPS.length - 1 && "pb-0")}>
              <p
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  active || done ? "text-primary" : "text-muted-foreground",
                )}
              >
                Step {index + 1}
              </p>
              <p
                className={cn(
                  "text-lg",
                  active
                    ? "font-bold text-primary"
                    : "font-medium text-foreground",
                )}
              >
                {step.short}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
