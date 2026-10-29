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
import { SubmitOrderError } from '../../src/orders/application/errors/submit-order.error.js';
import { PreparedOrderPersistenceError } from '../../src/orders/application/errors/prepared-order-persistence.error.js';
import type { SubmitOrderUseCase } from '../../src/orders/application/ports/in/submit-order.use-case.js';
import { OrderIntentError } from '../../src/orders/domain/order-intent.error.js';
import { SubmitOrderBodyPipe } from '../../src/orders/infrastructure/http/submit-order-body.pipe.js';
import { SubmitOrderController } from '../../src/orders/infrastructure/http/submit-order.controller.js';
import {
  INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
  SUBMIT_ORDER_CONFLICT_MESSAGE,
  SUBMIT_ORDER_NOT_FOUND_MESSAGE,
  SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
} from '../../src/orders/infrastructure/http/http-messages.js';
import { SUBMIT_ORDER_USE_CASE } from '../../src/orders/orders.tokens.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';

const KEY = '123E4567-E89B-12D3-A456-426614174000';
const NORMALIZED_KEY = KEY.toLowerCase();
const INVALID = { message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE };
const NOT_FOUND = { message: SUBMIT_ORDER_NOT_FOUND_MESSAGE };
const CONFLICT = { message: SUBMIT_ORDER_CONFLICT_MESSAGE };
const UNAVAILABLE = { message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE };

const LIMIT_BODY = {
  instrumentId: 47,
  side: 'BUY',
  type: 'LIMIT',
  size: 3,
  price: '10.00',
};

let app: INestApplication;
let rawPort: number;
const execute = vi.fn<SubmitOrderUseCase['execute']>();

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({
    controllers: [SubmitOrderController],
    providers: [
      SubmitOrderBodyPipe,
      {
        provide: SUBMIT_ORDER_USE_CASE,
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
  execute.mockResolvedValue({
    orderId: 7,
    status: 'NEW',
    replayed: false,
  });
});

function server(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

function route(userId = '1'): string {
  return `/users/${userId}/orders`;
}

function post(
  body: object | string = LIMIT_BODY,
  key: string | null = KEY,
): request.Test {
  const test = request(server()).post(route());

  if (key !== null) {
    test.set('Idempotency-Key', key);
  }

  return test.send(body);
}

function postRawJson(body: string, key: string | null = KEY): request.Test {
  const test = request(server()).post(route()).type('json');

  if (key !== null) {
    test.set('Idempotency-Key', key);
  }

  return test.send(body);
}

interface RawResponse {
  readonly statusCode: number;
  readonly body: string;
}

function sendRaw(
  headers: readonly (readonly [string, string | string[]])[],
  body = '',
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: rawPort,
        path: route(),
        method: 'POST',
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    for (const [name, value] of headers) {
      request.setHeader(name, value);
    }

    if (body.length > 0) {
      request.setHeader('Content-Length', String(Buffer.byteLength(body)));
    }

    request.on('error', reject);
    request.end(body);
  });
}

describe('POST /users/:userId/orders validation', () => {
  it('returns the exact 201 projection and maps the body to the internal intent', async () => {
    const response = await post().expect(201);

    expect(response.body).toEqual({
      order: { id: 7, status: 'NEW' },
    });
    expect(Object.keys(response.body)).toEqual(['order']);
    expect(Object.keys(response.body.order).sort()).toEqual(['id', 'status']);
    expect(response.headers.location).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({
      userId: 1,
      idempotencyKey: NORMALIZED_KEY,
      intent: {
        instrumentId: 47,
        side: 'BUY',
        type: 'LIMIT',
        mode: 'size',
        size: '3',
        amount: null,
        limitPrice: '10',
      },
    });
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('currency');
  });

  it('returns the exact 200 projection for a replayed order without extra fields', async () => {
    execute.mockResolvedValueOnce({
      orderId: 12,
      status: 'CANCELLED',
      replayed: true,
    });

    const response = await post().expect(200);

    expect(response.body).toEqual({
      order: { id: 12, status: 'CANCELLED' },
    });
    expect(Object.keys(response.body)).toEqual(['order']);
    expect(Object.keys(response.body.order).sort()).toEqual(['id', 'status']);
    expect(response.headers.location).toBeUndefined();
  });

  it.each(['NEW', 'FILLED', 'REJECTED'] as const)(
    'returns 201 for a newly created %s order',
    async (status) => {
      execute.mockResolvedValueOnce({ orderId: 5, status, replayed: false });

      const response = await post().expect(201);

      expect(response.body).toEqual({ order: { id: 5, status } });
    },
  );

  it.each(['NEW', 'FILLED', 'REJECTED', 'CANCELLED'] as const)(
    'returns 200 for a replayed %s order',
    async (status) => {
      execute.mockResolvedValueOnce({ orderId: 5, status, replayed: true });

      const response = await post().expect(200);

      expect(response.body).toEqual({ order: { id: 5, status } });
    },
  );

  it('accepts leading zeroes in the route userId', async () => {
    const response = await request(server())
      .post('/users/0001/orders')
      .set('Idempotency-Key', KEY)
      .send(LIMIT_BODY)
      .expect(201);

    expect(response.body).toEqual({
      order: { id: 7, status: 'NEW' },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, idempotencyKey: NORMALIZED_KEY }),
    );
  });

  it('accepts a lowercase and a mixed-case UUID and normalizes it', async () => {
    await post(LIMIT_BODY, KEY.toLowerCase()).expect(201);
    await post(LIMIT_BODY, '123E4567-e89b-12D3-a456-426614174000').expect(201);

    expect(execute.mock.calls[0]?.[0].idempotencyKey).toBe(NORMALIZED_KEY);
    expect(execute.mock.calls[1]?.[0].idempotencyKey).toBe(NORMALIZED_KEY);
  });

  it.each([
    ['3.0', '3'],
    ['1e3', '1000'],
  ])(
    'accepts the JSON number form %s as the integer %s',
    async (jsonNumber, expectedSize) => {
      const body = `{"instrumentId":47,"side":"BUY","type":"MARKET","size":${jsonNumber}}`;

      await postRawJson(body).expect(201);

      expect(execute.mock.calls[0]?.[0].intent).toMatchObject({
        mode: 'size',
        size: expectedSize,
      });
    },
  );

  it('maps an amount string to the canonical internal value', async () => {
    await post({
      instrumentId: 47,
      side: 'SELL',
      type: 'MARKET',
      amount: '0001.00',
    }).expect(201);

    expect(execute.mock.calls[0]?.[0].intent).toMatchObject({
      mode: 'amount',
      amount: '1',
      size: null,
    });
  });

  it('accepts the INT boundaries', async () => {
    await post({
      instrumentId: 2_147_483_647,
      side: 'BUY',
      type: 'MARKET',
      size: 2_147_483_647,
    }).expect(201);

    expect(execute.mock.calls[0]?.[0].intent).toMatchObject({
      instrumentId: 2_147_483_647,
      size: '2147483647',
    });
  });

  it('accepts a price with eight integer digits', async () => {
    await post({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      size: 1,
      price: '12345678.99',
    }).expect(201);

    expect(execute.mock.calls[0]?.[0].intent.limitPrice).toBe('12345678.99');
  });

  it.each([
    '/users/0/orders',
    '/users/000/orders',
    '/users/-1/orders',
    '/users/+1/orders',
    '/users/1.0/orders',
    '/users/1e3/orders',
    '/users/0x10/orders',
    '/users/abc/orders',
    '/users/2147483648/orders',
    '/users/0002147483648/orders',
    '/users/999999999999999999999/orders',
    '/users/%201/orders',
    '/users/%EF%BC%91/orders',
    '/users/%ZZ/orders',
    '/users/%E0%A4%A/orders',
  ])('returns the exact 400 without invoking the use case for %s', async (path) => {
    const response = await request(server())
      .post(path)
      .set('Idempotency-Key', KEY)
      .send(LIMIT_BODY)
      .expect(400);

    expect(response.body).toEqual(INVALID);
    expect(Object.keys(response.body)).toEqual(['message']);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', null],
    ['malformed', 'not-a-uuid'],
    ['urn prefix', `urn:uuid:${KEY}`],
    ['braces', `{${KEY}}`],
    ['compact', KEY.replaceAll('-', '')],
    ['comma-separated', `${KEY},${KEY}`],
    ['internal space', KEY.replace('-', ' ')],
  ])('returns the exact 400 for an %s Idempotency-Key', async (_label, key) => {
    const response = await post(LIMIT_BODY, key as string | null).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a repeated Idempotency-Key header deterministically', async () => {
    const raw = await sendRaw(
      [
        ['Idempotency-Key', [KEY, KEY]],
        ['Content-Type', 'application/json'],
      ],
      JSON.stringify(LIMIT_BODY),
    );

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain(KEY);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{"broken":'],
    ['null', 'null'],
    ['string', '"text"'],
    ['number', '42'],
    ['boolean', 'true'],
    ['array', '[]'],
    ['empty object', '{}'],
  ])('returns the exact 400 for a %s body', async (_label, body) => {
    const response = await postRawJson(body).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', undefined, undefined],
    ['a text/plain body', JSON.stringify(LIMIT_BODY), 'text/plain'],
  ] as const)('returns the exact 400 for %s', async (_label, body, contentType) => {
    const test = request(server())
      .post(route())
      .set('Idempotency-Key', KEY);

    if (contentType !== undefined) {
      test.set('Content-Type', contentType);
    }

    const response = await test.send(body).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts the same raw JSON when it only contains allowed fields', async () => {
    const response = await postRawJson(JSON.stringify(LIMIT_BODY)).expect(201);

    expect(response.body).toEqual({
      order: { id: 7, status: 'NEW' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'ordinary unknown',
      'currency',
      `{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","currency":"ARS"}`,
    ],
    [
      '__proto__',
      '__proto__',
      `{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","__proto__":{"polluted":true}}`,
    ],
    [
      'constructor',
      'constructor',
      `{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00","constructor":{"polluted":true}}`,
    ],
  ])(
    'returns the exact 400 and does not invoke the use case for an own %s field',
    async (_label, field, body) => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      expect(Object.hasOwn(parsed, field)).toBe(true);

      const response = await postRawJson(body).expect(400);

      expect(response.body).toEqual(INVALID);
      expect(Object.keys(response.body)).toEqual(['message']);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'unknown currency',
      { ...LIMIT_BODY, currency: 'ARS' },
    ],
    [
      'unknown ticker',
      { ...LIMIT_BODY, ticker: 'PAMP' },
    ],
    [
      'null instrumentId',
      { ...LIMIT_BODY, instrumentId: null },
    ],
    [
      'string instrumentId',
      { ...LIMIT_BODY, instrumentId: '47' },
    ],
    [
      'instrumentId above INT',
      { ...LIMIT_BODY, instrumentId: 2_147_483_648 },
    ],
    [
      'lowercase side',
      { ...LIMIT_BODY, side: 'buy' },
    ],
    [
      'lowercase type',
      { ...LIMIT_BODY, type: 'limit' },
    ],
    [
      'null size',
      { ...LIMIT_BODY, size: null },
    ],
    [
      'string size',
      { ...LIMIT_BODY, size: '3' },
    ],
    [
      'size above INT',
      { ...LIMIT_BODY, size: 2_147_483_648 },
    ],
    [
      'both size and amount',
      { ...LIMIT_BODY, amount: '10.00' },
    ],
    [
      'neither size nor amount',
      { instrumentId: 47, side: 'BUY', type: 'MARKET' },
    ],
    [
      'numeric amount',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: 10,
      },
    ],
    [
      'null amount',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: null,
      },
    ],
    [
      'amount with three written decimals',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '10.000',
      },
    ],
    [
      'amount with three non-zero decimals',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '10.001',
      },
    ],
    [
      'amount with exponent',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '1e3',
      },
    ],
    [
      'amount with sign',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '-1',
      },
    ],
    [
      'amount with space',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: ' 1',
      },
    ],
    [
      'amount with comma',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '1,0',
      },
    ],
    [
      'amount with hex prefix',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '0x10',
      },
    ],
    [
      'amount with underscore',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '1_000',
      },
    ],
    [
      'zero amount',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'MARKET',
        amount: '0',
      },
    ],
    [
      'MARKET with a price',
      { ...LIMIT_BODY, type: 'MARKET' },
    ],
    [
      'MARKET with a null price',
      { ...LIMIT_BODY, type: 'MARKET', price: null },
    ],
    [
      'LIMIT without a price',
      {
        instrumentId: 47,
        side: 'BUY',
        type: 'LIMIT',
        size: 3,
      },
    ],
    [
      'price with three written decimals',
      { ...LIMIT_BODY, price: '10.000' },
    ],
    [
      'price with three non-zero decimals',
      { ...LIMIT_BODY, price: '10.001' },
    ],
    [
      'price with exponent',
      { ...LIMIT_BODY, price: '1e3' },
    ],
    [
      'price with sign',
      { ...LIMIT_BODY, price: '+10' },
    ],
    [
      'price with comma',
      { ...LIMIT_BODY, price: '10,00' },
    ],
    [
      'price with nine integer digits',
      { ...LIMIT_BODY, price: '123456789.00' },
    ],
    [
      'price with nine normalized integer digits',
      { ...LIMIT_BODY, price: '000000000123456789.00' },
    ],
  ])('returns the exact 400 for %s', async (_label, body) => {
    const response = await post(body).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns 400 when the amount is not representable as a quantity', async () => {
    execute.mockRejectedValueOnce(
      new SubmitOrderError('quantity-not-representable'),
    );

    const response = await post({
      instrumentId: 47,
      side: 'BUY',
      type: 'LIMIT',
      amount: '100.00',
      price: '300.00',
    }).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('POST /users/:userId/orders error translation', () => {
  it.each([
    ['account-not-found', 404, NOT_FOUND],
    ['instrument-not-found', 404, NOT_FOUND],
    ['conflict', 409, CONFLICT],
    ['unsupported-currency', 400, INVALID],
    ['instrument-not-tradable', 400, INVALID],
    ['quantity-not-representable', 400, INVALID],
    ['quote-unavailable', 500, UNAVAILABLE],
    ['quote-invalid', 500, UNAVAILABLE],
  ] as const)(
    'maps %s to %d with the exact message',
    async (code, expectedStatus, expectedBody) => {
      execute.mockRejectedValueOnce(new SubmitOrderError(code));

      const response = await post().expect(expectedStatus);

      expect(response.body).toEqual(expectedBody);
    },
  );

  it.each([
    ['invalid persisted metadata', new OrderIntentError('invalid-metadata')],
    [
      'unsupported metadata version',
      new OrderIntentError('unsupported-metadata-version'),
    ],
    [
      'prepared-order persistence failure',
      new PreparedOrderPersistenceError(new Error('sensitive SQL detail')),
    ],
    ['generic failure', new Error('sensitive unknown detail')],
  ])('maps %s to the exact sanitized 500', async (_label, failure) => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(failure);

    const response = await post().expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=order-submission');
    expect(logged).not.toContain('sensitive');
    expect(logged).not.toContain('\n');
  });

  it('maps an uncertain commit to the exact generic 500 without claiming rollback', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(
      new AccountTransactionError({
        stage: 'commit',
        commitOutcome: 'uncertain',
        clientDisposition: 'discarded',
        cause: new Error('sensitive connection detail'),
      }),
    );

    const response = await post().expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(JSON.stringify(response.body)).not.toContain('rollback');
    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('AccountTransactionError');
    expect(logged).not.toContain('sensitive connection detail');
  });
});
