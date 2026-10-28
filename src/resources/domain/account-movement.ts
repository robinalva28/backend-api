export type OrderSide = 'BUY' | 'SELL' | 'CASH_IN' | 'CASH_OUT';

export type OrderStatus = 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';

export interface AccountMovement {
  readonly id: number;
  readonly instrumentId: number;
  readonly side: OrderSide;
  readonly status: OrderStatus;
  readonly size: number;
  readonly price: string | null;
}
