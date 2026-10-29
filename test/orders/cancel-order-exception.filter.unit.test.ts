import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelOrderError } from '../../src/orders/application/errors/cancel-order.error.js';
import { OrderCancellationMappingError } from '../../src/orders/application/errors/order-cancellation-mapping.error.js';
import { CancelOrderExceptionFilter } from '../../src/orders/infrastructure/http/cancel-order-exception.filter.js';
import {
  CANCEL_ORDER_UNAVAILABLE_MESSAGE,
  INVALID_CANCEL_REQUEST_MESSAGE,
  ORDER_NOT_CANCELLABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';

interface ResponseSpies {
  readonly host: ArgumentsHost;
  readonly status: ReturnType<typeof vi.fn>;
  readonly json: ReturnType<typeof vi.fn>;
}

function createHost(): ResponseSpies {
  const json = vi.fn();
  const status = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);

  return {
    host: {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost,
    status,
    json,
  };
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('CancelOrderExceptionFilter', () => {
  it.each([
    ['BadRequestException', new BadRequestException('specific parser detail')],
    ['invalid-input', new CancelOrderError('invalid-input')],
  ])('maps %s to the exact generic 400 response', (_label, failure) => {
    const filter = new CancelOrderExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: INVALID_CANCEL_REQUEST_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['account-not-found', 'order-not-found'] as const)(
    'maps %s to the exact generic 404 response',
    (code) => {
      const filter = new CancelOrderExceptionFilter();
      const { host, status, json } = createHost();

      filter.catch(new CancelOrderError(code), host);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({ message: ORDER_NOT_FOUND_MESSAGE });
      expect(log).not.toHaveBeenCalled();
    },
  );

  it('maps order-not-cancellable to the exact 409 response', () => {
    const filter = new CancelOrderExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new CancelOrderError('order-not-cancellable'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      message: ORDER_NOT_CANCELLABLE_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('maps transition-not-acknowledged to a sanitized 500', () => {
    const filter = new CancelOrderExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new CancelOrderError('transition-not-acknowledged'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: CANCEL_ORDER_UNAVAILABLE_MESSAGE,
    });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('maps an uncertain AccountTransactionError to 500 without leaking its cause', () => {
    const filter = new CancelOrderExceptionFilter();
    const { host, status, json } = createHost();
    const failure = new AccountTransactionError({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: new Error('sensitive driver detail'),
    });

    filter.catch(failure, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: CANCEL_ORDER_UNAVAILABLE_MESSAGE,
    });

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-cancellation');
    expect(logged).toContain('AccountTransactionError');
    expect(logged).not.toContain('sensitive driver detail');
  });

  it.each([
    new OrderCancellationMappingError('status'),
    new Error('sensitive SQL detail from the driver'),
    { unexpected: true },
  ])('maps an unknown technical failure %j to a sanitized 500', (failure) => {
    const filter = new CancelOrderExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(failure, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: CANCEL_ORDER_UNAVAILABLE_MESSAGE,
    });
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-cancellation');
    expect(logged).not.toContain('sensitive');
  });
});
