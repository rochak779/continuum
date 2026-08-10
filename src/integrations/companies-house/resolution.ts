export interface AlertResolutionStore {
  verifyAlert(alertId: string, actorId: string, verifiedAt: string): Promise<boolean>;
}

export interface VerifyAlertParams {
  alertId: string;
  actorId: string;
}

export async function verifyMonitoringAlert(
  params: VerifyAlertParams,
  store: AlertResolutionStore,
  now: () => Date = () => new Date(),
): Promise<void> {
  const verified = await store.verifyAlert(params.alertId, params.actorId, now().toISOString());
  if (!verified) throw new Error("Alert not found or is not available to this user");
}
