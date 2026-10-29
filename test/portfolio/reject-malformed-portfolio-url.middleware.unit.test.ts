import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { rejectMalformedPortfolioUrl } from '../../src/portfolio/infrastructure/http/reject-malformed-portfolio-url.middleware.js';

interface RequestOptions {
  readonly method?: string;
  readonly url?: string;
}

function createRequest(options: RequestOptions = {}): Request {
  return {
    method: options.method ?? 'GET',
    originalUrl: options.url ?? '/users/1/portfolio',
    url: options.url ?? '/users/1/portfolio',
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

describe('rejectMalformedPortfolioUrl', () => {
  it.each([
    '/users/1/portfolio',
    '/users/1/portfolio/',
    '/USERS/1/PORTFOLIO',
    '/users/%31/portfolio',
    '/users/1/portfolio?next=%ZZ',
    'http://127.0.0.1:3000/users/1/portfolio',
    'http://127.0.0.1:3000/users/1/portfolio?next=%ZZ',
  ])('accepts a decodable portfolio path: %s', (path) => {
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedPortfolioUrl(createRequest({ url: path }), response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/users/%ZZ/portfolio',
    '/users/%E0%A4%A/portfolio',
    '/users/%E0%A4/portfolio',
    '/users/%FF/portfolio',
    '/USERS/%ZZ/PORTFOLIO/',
    'http://127.0.0.1:3000/users/%ZZ/portfolio',
    'http://127.0.0.1:3000/users/%E0%A4%A/portfolio',
  ])('returns the exact generic 400 for malformed escapes: %s', (path) => {
    const { response, status, json } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedPortfolioUrl(createRequest({ url: path }), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(Object.keys(json.mock.calls[0]?.[0] ?? {})).toEqual(['message']);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', '/users/%ZZ/portfolio'],
    ['GET', '/users/%ZZ/portfolio/extra'],
    ['GET', '/users/%ZZ/orders'],
    ['GET', '/instruments?query=%ZZ'],
  ])('leaves the %s request outside the exact route unchanged: %s', (method, path) => {
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectMalformedPortfolioUrl(
      createRequest({ method, url: path }),
      response,
      next,
    );

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
