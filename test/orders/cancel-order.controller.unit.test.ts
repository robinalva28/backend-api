import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { CancelOrderUseCase } from '../../src/orders/application/ports/in/cancel-order.use-case.js';
import { CancelOrderController } from '../../src/orders/infrastructure/http/cancel-order.controller.js';

function createController(): {
  readonly controller: CancelOrderController;
  readonly execute: ReturnType<typeof vi.fn<CancelOrderUseCase['execute']>>;
} {
  const execute = vi.fn<CancelOrderUseCase['execute']>();
  execute.mockResolvedValue({ orderId: 7, status: 'CANCELLED' });

  return {
    controller: new CancelOrderController({ execute }),
    execute,
  };
}

describe('CancelOrderController', () => {
  it('forwards the parsed identifiers and returns the exact minimal projection', async () => {
    const { controller, execute } = createController();

    await expect(controller.cancel('1', '7')).resolves.toEqual({
      order: { id: 7, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 7 });
  });

  it.each([
    ['invalid user', '0', '7'],
    ['invalid order', '1', '2.5'],
    ['out-of-range user', '2147483648', '7'],
    ['non-ASCII order', '1', '１２３'],
  ])('rejects %s before invoking the use case', async (_label, userId, orderId) => {
    const { controller, execute } = createController();

    await expect(controller.cancel(userId, orderId)).rejects.toThrow(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates use-case errors for the HTTP exception filter', async () => {
    const { controller, execute } = createController();
    const failure = new Error('cancellation failure');
    execute.mockRejectedValueOnce(failure);

    await expect(controller.cancel('2', '9')).rejects.toBe(failure);
  });
});
