import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { rejectCancelOrderBody } from '../../src/orders/infrastructure/http/reject-cancel-order-body.middleware.js';

class FakeRequest extends EventEmitter {
  method = 'POST';
  originalUrl = '/users/1/orders/2/cancel';
  url = this.originalUrl;
  headers: Record<string, string> = {};
  readableEnded = false;
  readonly resume = vi.fn();
}

interface RequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Record<string, string>;
  readonly readableEnded?: boolean;
}

function createRequest(options: RequestOptions = {}): {
  readonly request: FakeRequest;
  readonly resume: ReturnType<typeof vi.fn>;
} {
  const request = new FakeRequest();
  request.method = options.method ?? 'POST';
  request.originalUrl = options.path ?? '/users/1/orders/2/cancel';
  request.url = request.originalUrl;
  request.headers = options.headers ?? {};
  request.readableEnded = options.readableEnded ?? false;

  return { request, resume: request.resume };
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

function asRequest(request: FakeRequest): Request {
  return request as unknown as Request;
}

describe('rejectCancelOrderBody', () => {
  it('rejects a body declared by Content-Length', () => {
    const { request, resume } = createRequest({
      headers: { 'content-length': '2' },
    });
    const { response, status, json } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a body declared by Content-Length on an absolute request-target', () => {
    const { request } = createRequest({
      path: 'http://127.0.0.1:3000/users/1/orders/2/cancel',
      headers: { 'content-length': '2' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts an empty chunked body on an absolute request-target', () => {
    const { request } = createRequest({
      path: 'http://127.0.0.1:3000/users/1/orders/2/cancel',
      headers: { 'transfer-encoding': 'chunked' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);
    request.emit('end');

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty chunked request when the stream ends without data', () => {
    const { request, resume } = createRequest({
      headers: { 'transfer-encoding': 'chunked' },
    });
    const { response, status, json } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(next).not.toHaveBeenCalled();
    request.emit('end');

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('rejects a chunked request as soon as data arrives', () => {
    const { request, resume } = createRequest({
      headers: { 'transfer-encoding': 'chunked' },
    });
    const { response, status, json } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);
    request.emit('data', Buffer.from('{}'));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ message: 'Invalid request.' });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();

    request.emit('end');
    request.emit('data', Buffer.from('more'));

    expect(json).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts empty chunks and then the end of a chunked stream', () => {
    const { request } = createRequest({
      headers: { 'transfer-encoding': 'chunked' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);
    request.emit('data', Buffer.alloc(0));
    request.emit('end');

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('inspects chunked framing even when Content-Length is zero', () => {
    const { request } = createRequest({
      headers: {
        'content-length': '0',
        'transfer-encoding': 'chunked',
      },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);
    request.emit('data', Buffer.from('{}'));

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['0000', '00'])(
    'accepts the zero content-length representation %s',
    (contentLength) => {
      const { request } = createRequest({
        headers: { 'content-length': contentLength },
      });
      const { response, status } = createResponse();
      const next = vi.fn() as unknown as NextFunction;

      rejectCancelOrderBody(asRequest(request), response, next);

      expect(status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  it('treats an invalid content-length header as a rejected body', () => {
    const { request } = createRequest({
      headers: { 'content-length': 'invalid' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/users/1/orders/2/cancel'],
    ['POST', '/instruments'],
    ['POST', '/users/1/orders/2'],
    ['POST', '/users/1/orders/2/cancel/extra'],
  ])('ignores a body outside the exact route: %s %s', (method, path) => {
    const { request } = createRequest({
      method,
      path,
      headers: { 'content-length': '2' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('matches the cancellation route case-insensitively and with a trailing slash', () => {
    const { request } = createRequest({
      path: '/USERS/1/ORDERS/2/CANCEL/',
      headers: { 'content-length': '1' },
    });
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows a request with no body headers', () => {
    const { request } = createRequest();
    const { response, status } = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    rejectCancelOrderBody(asRequest(request), response, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
