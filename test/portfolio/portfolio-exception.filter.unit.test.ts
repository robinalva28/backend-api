import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioError } from '../../src/portfolio/application/errors/portfolio.error.js';
import {
  INVALID_PORTFOLIO_REQUEST_MESSAGE,
  PORTFOLIO_UNAVAILABLE_MESSAGE,
  PORTFOLIO_USER_NOT_FOUND_MESSAGE,
} from '../../src/portfolio/infrastructure/http/http-messages.js';
import { PortfolioExceptionFilter } from '../../src/portfolio/infrastructure/http/portfolio-exception.filter.js';

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

describe('PortfolioExceptionFilter', () => {
  it.each([
    ['BadRequestException', new BadRequestException('specific parser detail')],
    ['invalid-input', new PortfolioError('invalid-input')],
  ])('maps %s to the exact generic 400', (_label, failure) => {
    const filter = new PortfolioExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(failure, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: INVALID_PORTFOLIO_REQUEST_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('maps user-not-found to the exact generic 404', () => {
    const filter = new PortfolioExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new PortfolioError('user-not-found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      message: PORTFOLIO_USER_NOT_FOUND_MESSAGE,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['read-failed', 'calculation-failed'] as const)(
    'maps %s to a sanitized 500 without exposing technical details',
    (code) => {
      const filter = new PortfolioExceptionFilter();
      const { host, status, json } = createHost();
      const cause = new Error('password=secret table=marketdata');

      filter.catch(new PortfolioError(code, { cause }), host);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        message: PORTFOLIO_UNAVAILABLE_MESSAGE,
      });
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]?.[0])).not.toContain('secret');
      expect(String(log.mock.calls[0]?.[0])).not.toContain('marketdata');
      expect(String(log.mock.calls[0]?.[0])).toContain('portfolio-read');
    },
  );

  it('maps an unknown error to a sanitized 500', () => {
    const filter = new PortfolioExceptionFilter();
    const { host, status, json } = createHost();

    filter.catch(new Error('raw driver detail'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      message: PORTFOLIO_UNAVAILABLE_MESSAGE,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain('raw driver detail');
  });
});
