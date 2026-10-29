import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import { PersistedOrderMappingError } from '../../src/orders/application/errors/persisted-order-mapping.error.js';
import { PreparedOrderPersistenceError } from '../../src/orders/application/errors/prepared-order-persistence.error.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import { PreparedOrderError } from '../../src/orders/domain/prepared-order.error.js';
import { SubmitOrderExceptionFilter } from '../../src/orders/infrastructure/http/submit-order-exception.filter.js';
import {
  INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
  SUBMIT_ORDER_CONFLICT_MESSAGE,
  SUBMIT_ORDER_NOT_FOUND_MESSAGE,
  SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
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

describe('SubmitOrderExceptionFilter', () => {
  it.each(['unsupported-currency', 'instrument-not-tradable', 'quantity-not-representable'] as const)(
    'maps %s to the exact generic 400',
    (code) => {
      const { host, status, json } = createHost();

      new SubmitOrderExceptionFilter().catch(
        new SubmitOrderError(code),
        host,
      );

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
      });
      expect(log).not.toHaveBeenCalled();
    },
  );

  it.each(['account-not-found', 'instrument-not-found'] as const)(
    'maps %s to the exact unified 404',
    (code) => {
      const { host, status, json } = createHost();

      new SubmitOrderExceptionFilter().catch(
        new SubmitOrderError(code),
        host,
      );

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({
        message: SUBMIT_ORDER_NOT_FOUND_MESSAGE,
      });
      expect(log).not.toHaveBeenCalled();
    },
  );

  it('maps conflict to the exact 409', () => {
    const { host, status, json } = createHost();

    new SubmitOrderExceptionFilter().catch(
      new SubmitOrderError('conflict'),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      message: SUBMIT_ORDER_CONFLICT_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['quote-unavailable', 'quote-invalid'] as const)(
    'maps %s to the sanitized 500',
    (code) => {
      const { host, status, json } = createHost();

      new SubmitOrderExceptionFilter().catch(
        new SubmitOrderError(code),
        host,
      );

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
      });
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it('maps BadRequestException to the exact generic 400 without logging', () => {
    const { host, status, json } = createHost();

    new SubmitOrderExceptionFilter().catch(
      new BadRequestException('parser detail'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['invalid-metadata', 'unsupported-metadata-version'] as const)(
    'maps persisted-metadata OrderIntentError %s to 500',
    (code) => {
      const { host, status, json } = createHost();

      new SubmitOrderExceptionFilter().catch(
        new OrderIntentError(code),
        host,
      );

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
      });
      expect(log).toHaveBeenCalledTimes(1);
    },
  );

  it('maps an uncertain AccountTransactionError to 500 without leaking its cause', () => {
    const { host, status, json } = createHost();
    const failure = new AccountTransactionError({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: new Error('sensitive driver detail'),
    });

    new SubmitOrderExceptionFilter().catch(failure, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
    });

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-submission');
    expect(logged).toContain('AccountTransactionError');
    expect(logged).not.toContain('sensitive driver detail');
    expect(logged).not.toContain('\n');
  });

  it.each([
    new PreparedOrderError('invalid-price'),
    new PreparedOrderPersistenceError(
      new Error('sensitive SQL detail from the driver'),
    ),
    new PersistedOrderMappingError('status'),
    new Error('sensitive unknown detail'),
    { unexpected: true },
  ])('maps the technical failure %j to a sanitized 500', (failure) => {
    const { host, status, json } = createHost();

    new SubmitOrderExceptionFilter().catch(failure, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
    });
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-submission');
    expect(logged).not.toContain('sensitive');
    expect(logged).not.toContain('\n');
  });
});
