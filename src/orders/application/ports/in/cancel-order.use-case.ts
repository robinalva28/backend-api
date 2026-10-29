export interface CancelOrderInput {
  readonly userId: number;
  readonly orderId: number;
}

export interface CancelOrderOutput {
  readonly orderId: number;
  readonly status: 'CANCELLED';
}

export interface CancelOrderUseCase {
  execute(input: CancelOrderInput): Promise<CancelOrderOutput>;
}
