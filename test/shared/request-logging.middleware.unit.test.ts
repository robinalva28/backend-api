import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createRequestLoggingMiddleware } from '../../src/shared/http/request-logging.middleware.js';
import { RecordingLogger } from '../support/recording-logger.js';

class FakeRequest {
  method = 'GET';
  originalUrl = '/';
  readonly headers: Record<string, string> = {};

  get(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): this {
    this.headers.set(name, value);

    return this;
  }

  finish(): void {
    this.writableFinished = true;
    this.emit('finish');
  }

  closeWithoutFinish(): void {
    this.emit('close');
  }
}

function execute(
  options: Parameters<typeof createRequestLoggingMiddleware>[0],
  request: FakeRequest,
  response: FakeResponse,
  next: NextFunction = () => undefined,
): void {
  createRequestLoggingMiddleware(options)(
    request as unknown as Request,
    response as unknown as Response,
    next,
  );
}

describe('request logging middleware', () => {
  it('generates a request id, returns it and logs one completion', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.originalUrl = '/users/42/portfolio?secret=not-logged';
    const response = new FakeResponse();

    execute(
      { logger, generateRequestId: () => 'generated-request-id' },
      request,
      response,
    );
    response.finish();

    expect(response.headers.get('X-Request-Id')).toBe('generated-request-id');
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({
      level: 'info',
      event: 'http.request.completed',
      fields: {
        requestId: 'generated-request-id',
        method: 'GET',
        route: '/users/:userId/portfolio',
        status: 200,
        accountUserId: 42,
      },
    });
    expect(JSON.stringify(logger.entries)).not.toContain('secret');
    expect(JSON.stringify(logger.entries)).not.toContain('/users/42/');
  });

  it('accepts a bounded incoming request id and replaces an unsafe one', () => {
    const firstLogger = new RecordingLogger();
    const firstRequest = new FakeRequest();
    firstRequest.headers['x-request-id'] = 'client-request_123:abc';
    const firstResponse = new FakeResponse();

    execute(
      { logger: firstLogger, generateRequestId: () => 'generated' },
      firstRequest,
      firstResponse,
    );
    firstResponse.finish();

    expect(firstResponse.headers.get('X-Request-Id')).toBe(
      'client-request_123:abc',
    );

    const secondLogger = new RecordingLogger();
    const secondRequest = new FakeRequest();
    secondRequest.headers['x-request-id'] = 'bad id with spaces';
    const secondResponse = new FakeResponse();

    execute(
      { logger: secondLogger, generateRequestId: () => 'generated' },
      secondRequest,
      secondResponse,
    );
    secondResponse.finish();

    expect(secondResponse.headers.get('X-Request-Id')).toBe('generated');
  });

  it('logs the order id validated from the cancellation route', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.method = 'POST';
    request.originalUrl = '/users/42/orders/81/cancel';
    const response = new FakeResponse();

    execute({ logger }, request, response);
    response.statusCode = 200;
    response.finish();

    expect(logger.entries[0]?.fields).toMatchObject({
      route: '/users/:userId/orders/:orderId/cancel',
      accountUserId: 42,
      orderId: 81,
    });
  });

  it('omits account identifiers for invalid route entries', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.originalUrl = '/users/not-a-number/portfolio';
    const response = new FakeResponse();

    execute({ logger }, request, response);
    response.finish();

    expect(logger.entries[0]?.fields).toMatchObject({
      route: '/users/:userId/portfolio',
    });
    expect(logger.entries[0]?.fields).not.toHaveProperty('accountUserId');
  });

  it('does not warn for an ordinary 400 completion', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.originalUrl = '/instruments';
    const response = new FakeResponse();

    execute({ logger }, request, response);
    response.statusCode = 400;
    response.finish();

    expect(logger.events()).toEqual(['http.request.completed']);
    expect(logger.events('warn')).toEqual([]);
  });

  it('emits a slow-request warning in addition to the completion', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.originalUrl = '/instruments';
    const response = new FakeResponse();
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(3_000);

    try {
      execute({ logger, slowRequestThresholdMs: 1000 }, request, response);
      response.finish();
    } finally {
      now.mockRestore();
    }

    expect(logger.events()).toEqual([
      'http.request.completed',
      'http.request.slow',
    ]);
    expect(logger.entries[1]?.fields).toMatchObject({
      durationMs: 2000,
      thresholdMs: 1000,
    });
  });

  it('emits exactly one aborted event when the connection closes early', () => {
    const logger = new RecordingLogger();
    const request = new FakeRequest();
    request.originalUrl = '/users/42/orders';
    const response = new FakeResponse();

    execute({ logger }, request, response);
    response.closeWithoutFinish();
    response.closeWithoutFinish();

    expect(logger.events()).toEqual(['http.request.aborted']);
    expect(logger.entries[0]?.fields).toMatchObject({
      requestId: expect.any(String),
      method: 'GET',
      route: '/users/:userId/orders',
      accountUserId: 42,
    });
    expect(logger.entries[0]?.fields).not.toHaveProperty('status');
  });

});
