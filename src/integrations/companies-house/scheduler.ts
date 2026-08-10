import type { CheckOutcome } from "./monitor";

export interface EligibleVendor {
  vendorId: string;
  companyNumber: string;
}

export interface SchedulerStore {
  acquireLease(token: string, leaseMs: number): Promise<boolean>;
  releaseLease(token: string): Promise<void>;
  recoverStaleRuns(staleBefore: string): Promise<void>;
  getEligibleVendors(limit: number): Promise<EligibleVendor[]>;
  beginRun(
    vendor: EligibleVendor,
    trigger: "manual" | "scheduled" | "retry",
  ): Promise<string | null>;
  finishRun(runId: string, outcome: CheckOutcome | Error): Promise<void>;
  markChecked(vendorId: string, checkedAt: string): Promise<void>;
}

export interface SchedulerOptions {
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
  minimumRequestIntervalMs?: number;
  transientBackoffMs?: number;
  maxRetryDelayMs?: number;
}

export interface SchedulerDeps {
  store: SchedulerStore;
  runCheck(vendor: EligibleVendor): Promise<CheckOutcome>;
  sleep?(milliseconds: number): Promise<void>;
  now?(): Date;
  token?(): string;
}

export interface SchedulerSummary {
  status: "completed" | "overlap_skipped";
  eligible: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const TRANSIENT_ERRORS = new Set(["rate_limited", "unavailable", "timeout", "network_error"]);

function retryDelay(
  outcome: Extract<CheckOutcome, { status: "failed" }>,
  attempt: number,
  base: number,
) {
  if (outcome.errorType === "rate_limited" && outcome.retryAfterSeconds !== undefined) {
    return outcome.retryAfterSeconds * 1_000;
  }
  return base * 2 ** (attempt - 1);
}

export async function runScheduledBatch(
  deps: SchedulerDeps,
  options: SchedulerOptions = {},
): Promise<SchedulerSummary> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 3;
  const leaseMs = options.leaseMs ?? 15 * 60_000;
  const minimumRequestIntervalMs = options.minimumRequestIntervalMs ?? 500;
  const transientBackoffMs = options.transientBackoffMs ?? 1_000;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 5 * 60_000;
  const sleep =
    deps.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = deps.now ?? (() => new Date());
  const token = (deps.token ?? (() => crypto.randomUUID()))();

  if (!(await deps.store.acquireLease(token, leaseMs))) {
    return { status: "overlap_skipped", eligible: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let vendors: EligibleVendor[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  try {
    await deps.store.recoverStaleRuns(new Date(now().getTime() - leaseMs).toISOString());
    vendors = await deps.store.getEligibleVendors(batchSize);
    for (const [index, vendor] of vendors.entries()) {
      if (index > 0 && minimumRequestIntervalMs > 0) await sleep(minimumRequestIntervalMs);
      if (index > 0 && !(await deps.store.acquireLease(token, leaseMs))) {
        skipped += vendors.length - index;
        break;
      }
      const runId = await deps.store.beginRun(vendor, "scheduled");
      if (!runId) {
        skipped += 1;
        continue;
      }

      let finalOutcome: CheckOutcome | Error = new Error("Monitoring did not run");
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          finalOutcome = await deps.runCheck(vendor);
          if (finalOutcome.status === "ok") break;
          if (!TRANSIENT_ERRORS.has(finalOutcome.errorType) || attempt === maxAttempts) break;
          const delay = retryDelay(finalOutcome, attempt, transientBackoffMs);
          if (delay > maxRetryDelayMs) break;
          await sleep(delay);
        }
        if (!(finalOutcome instanceof Error) && finalOutcome.status === "ok") succeeded += 1;
        else failed += 1;
      } catch (error) {
        finalOutcome = error instanceof Error ? error : new Error(String(error));
        failed += 1;
      }

      try {
        await deps.store.finishRun(runId, finalOutcome);
        await deps.store.markChecked(vendor.vendorId, now().toISOString());
      } catch {
        // Bookkeeping failure for one vendor must not prevent the rest of the batch.
      }
    }
  } finally {
    await deps.store.releaseLease(token);
  }

  return { status: "completed", eligible: vendors.length, succeeded, failed, skipped };
}
