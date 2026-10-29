import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';
import { CancelOrderError } from '../../src/orders/application/errors/cancel-order.error.js';
import { OrderCancellationMappingError } from '../../src/orders/application/errors/order-cancellation-mapping.error.js';
import type { CancelOrderUseCase } from '../../src/orders/application/ports/in/cancel-order.use-case.js';
import { CancelOrderController } from '../../src/orders/infrastructure/http/cancel-order.controller.js';
import {
  CANCEL_ORDER_UNAVAILABLE_MESSAGE,
  INVALID_CANCEL_REQUEST_MESSAGE,
  ORDER_NOT_CANCELLABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { CANCEL_ORDER_USE_CASE } from '../../src/orders/orders.tokens.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';

const INVALID = { message: INVALID_CANCEL_REQUEST_MESSAGE };
const NOT_FOUND = { message: ORDER_NOT_FOUND_MESSAGE };
const NOT_CANCELLABLE = { message: ORDER_NOT_CANCELLABLE_MESSAGE };
const UNAVAILABLE = { message: CANCEL_ORDER_UNAVAILABLE_MESSAGE };

let app: INestApplication;
let rawPort: number;
const execute = vi.fn<CancelOrderUseCase['execute']>();

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({
    controllers: [CancelOrderController],
    providers: [
      {
        provide: CANCEL_ORDER_USE_CASE,
        useValue: { execute },
      },
    ],
  }).compile();

  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();

  if (address === null || typeof address === 'string') {
    throw new Error('The test HTTP server did not expose a TCP port.');
  }

  rawPort = address.port;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async ({ orderId }) => ({
    orderId,
    status: 'CANCELLED',
  }));
});

function httpServer(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

function absoluteUrl(path: string): string {
  return `http://127.0.0.1:${rawPort}${path}`;
}

interface RawResponse {
  readonly statusCode: number;
  readonly body: string;
}

function sendRaw(
  path: string,
  headers: Record<string, string> = {},
  chunks: readonly string[] = [],
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: rawPort,
        path,
        method: 'POST',
        headers,
      },
      (response) => {
        const body: Buffer[] = [];
        response.on('data', (chunk: Buffer) => body.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(body).toString('utf8'),
          });
        });
      },
    );

    request.on('error', reject);

    for (const chunk of chunks) {
      request.write(chunk);
    }

    request.end();
  });
}

describe('POST /users/:userId/orders/:orderId/cancel validation', () => {
  it('returns the exact 200 projection for a valid cancellation', async () => {
    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(200);

    expect(response.body).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(Object.keys(response.body)).toEqual(['order']);
    expect(Object.keys(response.body.order).sort()).toEqual(['id', 'status']);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 2 });
  });

  it('accepts leading zeroes and returns the numeric id', async () => {
    const response = await request(httpServer())
      .post('/users/0001/orders/0000002/cancel')
      .expect(200);

    expect(response.body).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 2 });
  });

  it('accepts both INT boundaries with leading zeroes', async () => {
    const response = await request(httpServer())
      .post('/users/0002147483647/orders/0000000002147483647/cancel')
      .expect(200);

    expect(response.body).toEqual({
      order: { id: 2_147_483_647, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledWith({
      userId: 2_147_483_647,
      orderId: 2_147_483_647,
    });
  });

  it('returns 200 for a repeated successful request', async () => {
    const first = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(200);
    const second = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(200);

    expect(first.body).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(second.body).toEqual(first.body);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not require or use Idempotency-Key', async () => {
    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .set('Idempotency-Key', 'not-a-uuid')
      .expect(200);

    expect(response.body).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 2 });
  });

  it.each([
    '/users/0/orders/2/cancel',
    '/users/000/orders/2/cancel',
    '/users/-1/orders/2/cancel',
    '/users/+1/orders/2/cancel',
    '/users/1.0/orders/2/cancel',
    '/users/1e3/orders/2/cancel',
    '/users/0x10/orders/2/cancel',
    '/users/abc/orders/2/cancel',
    '/users/2147483648/orders/2/cancel',
    '/users/0002147483648/orders/2/cancel',
    '/users/999999999999999999999/orders/2/cancel',
    '/users/1/orders/0/cancel',
    '/users/1/orders/000/cancel',
    '/users/1/orders/-1/cancel',
    '/users/1/orders/1.5/cancel',
    '/users/1/orders/1e3/cancel',
    '/users/1/orders/2147483648/cancel',
    '/users/1/orders/999999999999999999999/cancel',
    '/users/%201/orders/2/cancel',
    '/users/1/orders/%202/cancel',
    '/users/%EF%BC%91/orders/2/cancel',
    '/users/1/orders/1%2E0/cancel',
  ])('returns the exact 400 without invoking the use case for %s', async (path) => {
    const response = await request(httpServer()).post(path).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(Object.keys(response.body)).toEqual(['message']);
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts an empty body', async () => {
    await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(200);
  });

  it('accepts an explicit zero content-length without content', async () => {
    await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .set('Content-Length', '0')
      .expect(200);
  });

  it.each([
    [
      'empty JSON object',
      { contentType: 'application/json', body: {} },
    ],
    [
      'JSON object',
      { contentType: 'application/json', body: { reason: 'not allowed' } },
    ],
    [
      'JSON array',
      { contentType: 'application/json', body: [] },
    ],
    [
      'malformed JSON',
      { contentType: 'application/json', body: '{"broken":' },
    ],
    [
      'plain text',
      { contentType: 'text/plain', body: 'not allowed' },
    ],
    [
      'URL-encoded form',
      { contentType: 'application/x-www-form-urlencoded', body: 'a=b' },
    ],
    [
      'octet stream',
      { contentType: 'application/octet-stream', body: Buffer.from([1, 2]) },
    ],
  ])('returns the exact 400 for a %s body', async (_label, fixture) => {
    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .set('Content-Type', fixture.contentType)
      .send(fixture.body)
      .expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('POST /users/:userId/orders/:orderId/cancel raw framing and URL escapes', () => {
  it('accepts a chunked request that ends without data', async () => {
    const raw = await sendRaw('/users/1/orders/2/cancel', {
      'Transfer-Encoding': 'chunked',
    });

    expect(raw.statusCode).toBe(200);
    expect(JSON.parse(raw.body)).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 2 });
  });

  it('rejects a chunked request as soon as it sends content', async () => {
    const raw = await sendRaw(
      '/users/1/orders/2/cancel',
      { 'Transfer-Encoding': 'chunked' },
      ['{}'],
    );

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain('Failed to decode');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    '/users/%ZZ/orders/2/cancel',
    '/users/1/orders/%E0%A4%A/cancel',
  ])('returns the exact 400 for the malformed escape %s', async (path) => {
    const raw = await sendRaw(path);

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain('Failed to decode');
    expect(raw.body).not.toContain(path);
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts an empty valid request using an absolute request-target', async () => {
    const raw = await sendRaw(absoluteUrl('/users/1/orders/2/cancel'), {
      'Content-Length': '0',
    });

    expect(raw.statusCode).toBe(200);
    expect(JSON.parse(raw.body)).toEqual({
      order: { id: 2, status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1, orderId: 2 });
  });

  it('rejects an absolute request-target with a Content-Length body', async () => {
    const raw = await sendRaw(
      absoluteUrl('/users/1/orders/2/cancel'),
      {
        'Content-Type': 'application/json',
        'Content-Length': '2',
      },
      ['{}'],
    );

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects an absolute request-target with a chunked body', async () => {
    const raw = await sendRaw(
      absoluteUrl('/users/1/orders/2/cancel'),
      { 'Transfer-Encoding': 'chunked' },
      ['{}'],
    );

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    '/users/%ZZ/orders/2/cancel',
    '/users/1/orders/%E0%A4%A/cancel',
  ])(
    'returns the exact 400 for the malformed escape in an absolute URI: %s',
    async (path) => {
      const absolute = absoluteUrl(path);
      const raw = await sendRaw(absolute);

      expect(raw.statusCode).toBe(400);
      expect(JSON.parse(raw.body)).toEqual(INVALID);
      expect(raw.body).not.toContain('Failed to decode');
      expect(raw.body).not.toContain(absolute);
      expect(execute).not.toHaveBeenCalled();
    },
  );
});

describe('POST /users/:userId/orders/:orderId/cancel errors', () => {
  it.each(['account-not-found', 'order-not-found'] as const)(
    'maps %s to the exact 404 without exposing the internal distinction',
    async (code) => {
      execute.mockRejectedValueOnce(new CancelOrderError(code));

      const response = await request(httpServer())
        .post('/users/1/orders/999/cancel')
        .expect(404);

      expect(response.body).toEqual(NOT_FOUND);
      expect(Object.keys(response.body)).toEqual(['message']);
    },
  );

  it('maps order-not-cancellable to the exact 409', async () => {
    execute.mockRejectedValueOnce(
      new CancelOrderError('order-not-cancellable'),
    );

    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(409);

    expect(response.body).toEqual(NOT_CANCELLABLE);
  });

  it('maps an internal invalid-input error to the exact 400', async () => {
    execute.mockRejectedValueOnce(new CancelOrderError('invalid-input'));

    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(400);

    expect(response.body).toEqual(INVALID);
  });

  it.each([
    ['transition-not-acknowledged', new CancelOrderError('transition-not-acknowledged')],
    ['mapping error', new OrderCancellationMappingError('status')],
    [
      'uncertain commit',
      new AccountTransactionError({
        stage: 'commit',
        commitOutcome: 'uncertain',
        clientDisposition: 'discarded',
        cause: new Error('sensitive connection detail'),
      }),
    ],
    ['generic technical error', new Error('sensitive SQL detail')],
  ])('maps %s to the exact sanitized 500', async (_label, failure) => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(failure);

    const response = await request(httpServer())
      .post('/users/1/orders/2/cancel')
      .expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-cancellation');
    expect(logged).not.toContain('sensitive');
    expect(logged).not.toContain('\n');
  });
});
