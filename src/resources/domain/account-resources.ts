import type { Decimal } from 'decimal.js';

export interface InstrumentResources {
  readonly instrumentId: number;
  readonly executedQuantity: number;
  readonly sellReservedQuantity: number;
  readonly availableQuantity: number;
}

export interface AccountResources {
  readonly accountingCash: Decimal;
  readonly reservedBuyCash: Decimal;
  readonly availableCash: Decimal;
  readonly instruments: readonly InstrumentResources[];
}
