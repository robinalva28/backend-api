import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { SubmitOrderParserExceptionFilter } from '../../src/orders/infrastructure/http/submit-order-parser-exception.filter.js';

function createHost(url: string): {
  readonly host: ArgumentsHost;
  readonly status: ReturnType<typeof vi.fn>;
  readonly json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  const request = { originalUrl: url } as Request;

  return {
    host: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost,
    status,
    json,
  };
}

describe('SubmitOrderParserExceptionFilter', () => {
  it.each([
    '/users/1/orders',
    '/users/0001/orders/',
    '/users/1/orders?x=1',
    'http://example.test/users/1/orders',
  ])('normalizes a parser BadRequestException on %s to the exact 400', (url) => {
    const { host, status, json } = createHost(url);

    new SubmitOrderParserExceptionFilter().catch(
      new BadRequestException('sensitive parser detail'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
    });
  });

  it('preserves the default response for a non-submission path', () => {
    const { host, status, json } = createHost('/instruments?query=PAMP');
    const failure = new BadRequestException('parser detail');

    new SubmitOrderParserExceptionFilter().catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(failure.getResponse());
  });
});
