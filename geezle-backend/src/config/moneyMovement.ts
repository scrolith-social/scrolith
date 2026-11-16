export const MONEY_MOVEMENT_ENABLED_ENV = 'SCROLITH_MONEY_MOVEMENT_ENABLED';

export class MoneyMovementDisabledError extends Error {
  readonly code = 'MONEY_MOVEMENT_DISABLED';
  readonly status = 503;

  constructor() {
    super('Money movement is disabled by server policy.');
    this.name = 'MoneyMovementDisabledError';
  }
}

/**
 * Money movement is fail-closed. Test mode, provider configuration, and UI
 * feature settings are deliberately not treated as authorization to move funds.
 */
export const isMoneyMovementEnabled = (
  env: Record<string, string | undefined> = process.env
): boolean => String(env[MONEY_MOVEMENT_ENABLED_ENV] || '').trim().toLowerCase() === 'true';

export const assertMoneyMovementEnabled = (
  env: Record<string, string | undefined> = process.env
): void => {
  if (!isMoneyMovementEnabled(env)) throw new MoneyMovementDisabledError();
};
