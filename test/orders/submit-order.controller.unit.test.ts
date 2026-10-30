import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { SubmitOrderUseCase } from '../../src/orders/application/ports/in/submit-order.use-case.js';
import type { OrderIntent } from '../../src/orders/domain/order-intent.js';
import type { PersistedOrderStatus } from '../../src/orders/domain/persisted-order.js';
import { SubmitOrderController } from '../../src/orders/infrastructure/http/submit-order.controller.js';
import {
  currentRequestLogContext,
  runWithRequestLogContext,
} from '../../src/shared/logging/request-context.js';

const KEY = '123E4567-E89B-12D3-A456-426614174000';
const NORMALIZED_KEY = KEY.toLowerCase();

const INTENT: OrderIntent = {
  instrumentId: 47,
  side: 'BUY',
  type: 'LIMIT',
  mode: 'size',
  size: '3',
  amount: null,
  limitPrice: '10',
};

interface ControllerFixture {
  readonly controller: SubmitOrderController;
  readonly execute: ReturnType<typeof vi.fn<SubmitOrderUseCase['execute']>>;
  readonly status: ReturnType<typeof vi.fn>;
  readonly response: Response;
  readonly request: Request;
}

function createFixture(): ControllerFixture {
  const execute = vi.fn<SubmitOrderUseCase['execute']>();
  execute.mockResolvedValue({
    orderId: 7,
    status: 'NEW',
    replayed: false,
  });
  const status = vi.fn();
  const response = { status } as unknown as Response;
  status.mockReturnValue(response);
  const request = {
    rawHeaders: ['Idempotency-Key', KEY],
  } as unknown as Request;

  return {
    controller: new SubmitOrderController({ execute }),
    execute,
    status,
    response,
    request,
  };
}

describe('SubmitOrderController', () => {
  it('returns the exact 201 projection for a new order', async () => {
    const { controller, execute, status, response, request } = createFixture();

    await expect(
      controller.submit('0001', request, INTENT, response),
    ).resolves.toEqual({
      order: { id: 7, status: 'NEW' },
    });

    expect(status).toHaveBeenCalledWith(201);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      userId: 1,
      idempotencyKey: NORMALIZED_KEY,
      intent: INTENT,
    });
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('currency');
  });

  it('annotates the created order id in the active request context', async () => {
    const { controller, execute, response, request } = createFixture();
    execute.mockResolvedValueOnce({
      orderId: 81,
      status: 'NEW',
      replayed: false,
    });

    let captured: ReturnType<typeof currentRequestLogContext>;

    await runWithRequestLogContext(
      { requestId: 'request-123', accountUserId: 1 },
      async () => {
        await controller.submit('1', request, INTENT, response);
        captured = currentRequestLogContext();
      },
    );

    expect(captured).toMatchObject({
      requestId: 'request-123',
      accountUserId: 1,
      orderId: 81,
    });
  });

  it.each<PersistedOrderStatus>(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'])(
    'returns 200 for a replayed %s order',
    async (orderStatus) => {
      const { controller, execute, status, response, request } =
        createFixture();
      execute.mockResolvedValueOnce({
        orderId: 9,
        status: orderStatus,
        replayed: true,
      });

      await expect(
        controller.submit('2', request, INTENT, response),
      ).resolves.toEqual({
        order: { id: 9, status: orderStatus },
      });
      expect(status).toHaveBeenCalledWith(200);
    },
  );

  it.each([
    ['invalid user', '0', ['Idempotency-Key', KEY]],
    ['out-of-range user', '2147483648', ['Idempotency-Key', KEY]],
    ['non-ASCII user', '１２３', ['Idempotency-Key', KEY]],
    ['absent header', '1', []],
    ['malformed header', '1', ['Idempotency-Key', 'not-a-uuid']],
  ])('rejects %s before invoking the use case', async (_label, userId, headers) => {
    const { controller, execute, response } = createFixture();
    const request = {
      rawHeaders: headers,
    } as unknown as Request;

    await expect(
      controller.submit(userId as string, request, INTENT, response),
    ).rejects.toThrow(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates use-case failures for the HTTP exception filter', async () => {
    const { controller, execute, response, request } = createFixture();
    const failure = new Error('submission failure');
    execute.mockRejectedValueOnce(failure);

    await expect(
      controller.submit('1', request, INTENT, response),
    ).rejects.toBe(failure);
  });
});
