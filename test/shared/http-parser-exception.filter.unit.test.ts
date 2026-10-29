import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  HttpParserExceptionFilter,
  type ParserErrorRoute,
} from '../../src/shared/http/parser-exception.filter.js';

interface RequestOptions {
  readonly method?: string;
  readonly url?: string;
}

function createHost(options: RequestOptions = {}): {
  readonly host: ArgumentsHost;
  readonly status: ReturnType<typeof vi.fn>;
  readonly json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  const request = {
    method: options.method ?? 'GET',
    originalUrl: options.url ?? '/',
    url: options.url ?? '/',
  } as Request;

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

const portfolioRoute: ParserErrorRoute = {
  matches: (request) =>
    request.method === 'GET' &&
    request.originalUrl === '/users/1/portfolio',
  message: 'Invalid request.',
};

describe('HttpParserExceptionFilter', () => {
  it('normalizes a configured route to the exact generic 400', () => {
    const { host, status, json } = createHost({
      method: 'GET',
      url: '/users/1/portfolio',
    });

    new HttpParserExceptionFilter([portfolioRoute]).catch(
      new BadRequestException('parser detail with fictional marker'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(Object.keys(json.mock.calls[0]?.[0] ?? {})).toEqual(['message']);
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toContain(
      'fictional marker',
    );
  });

  it('uses the message of the first matching route', () => {
    const { host, status, json } = createHost({
      method: 'GET',
      url: '/users/1/portfolio',
    });

    new HttpParserExceptionFilter([
      {
        matches: () => true,
        message: 'Another message.',
      },
      portfolioRoute,
    ]).catch(new BadRequestException('parser detail'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Another message.' });
  });

  it('preserves the default response for a path that is not configured', () => {
    const { host, status, json } = createHost({
      method: 'GET',
      url: '/instruments?query=PAMP',
    });
    const failure = new BadRequestException('parser detail');

    new HttpParserExceptionFilter([portfolioRoute]).catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(failure.getResponse());
  });

  it('preserves the default response when no routes are configured', () => {
    const { host, status, json } = createHost({
      method: 'GET',
      url: '/users/1/portfolio',
    });
    const failure = new BadRequestException('parser detail');

    new HttpParserExceptionFilter().catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(failure.getResponse());
  });

  it('does not match a configured path with another method', () => {
    const { host, status, json } = createHost({
      method: 'POST',
      url: '/users/1/portfolio',
    });
    const failure = new BadRequestException('parser detail');

    new HttpParserExceptionFilter([portfolioRoute]).catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(failure.getResponse());
  });
});
