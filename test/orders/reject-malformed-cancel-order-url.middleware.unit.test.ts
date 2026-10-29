import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { rejectMalformedCancelOrderUrl } from '../../src/orders/infrastructure/http/reject-malformed-cancel-order-url.middleware.js';

interface RequestOptions {
  readonly method?: string;
  readonly url?: string;
}

function createRequest(options: RequestOptions = {}): Request {
  return {
    method: options.method ?? 'POST',
    originalUrl: options.url ?? '/users/1/orders/2/cancel',
    url: options.url ?? '/users/1/orders/2/cancel',
  } as unknown as Request;
}

function createResponse(): {
  readonly response: Response;
  readonly status: ReturnType<typeof vi.fn>;
  readonly json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);

  return { response, status, json };
}

describe('rejectMalformedCancelOrderUrl', () => {
  it.each([
    '/users/1/orders/2/cancel',
    '/users/1/orders/2/cancel/',
    '/USERS/1/ORDERS/2/CANCEL',
    '/users/%31/orders/2/cancel',
    '/users/1/orders/2/cancel?next=%ZZ',
    'http://127.0.0.1:3000/users/1/orders/2/cancel',
    'http://127.0.0.1:3000/users/1/orders/2/cancel?next=%ZZ',
  ])('accepts a decodable cancellation path: %s', (path) => {
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedCancelOrderUrl(createRequest({ url: path }), response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/users/%ZZ/orders/2/cancel',
    '/users/1/orders/%E0%A4%A/cancel',
    '/users/1/orders/%E0%A4/cancel',
    '/users/%FF/orders/2/cancel',
    '/USERS/%ZZ/ORDERS/2/CANCEL/',
    'http://127.0.0.1:3000/users/%ZZ/orders/2/cancel',
    'http://127.0.0.1:3000/users/1/orders/%E0%A4%A/cancel',
  ])('returns the exact generic 400 for malformed escapes: %s', (path) => {
    const { response, status, json } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedCancelOrderUrl(createRequest({ url: path }), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(Object.keys(json.mock.calls[0]?.[0] ?? {})).toEqual(['message']);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/users/%ZZ/orders/2/cancel'],
    ['POST', '/users/%ZZ/orders/2'],
    ['POST', '/instruments?query=%ZZ'],
    ['POST', '/users/1/orders/2/cancel/extra'],
  ])('leaves the %s request outside the exact route unchanged: %s', (method, path) => {
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedCancelOrderUrl(
      createRequest({ method, url: path }),
      response,
      next,
    );

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
