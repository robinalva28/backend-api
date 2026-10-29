import type { INestApplication } from '@nestjs/common';
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
import { PortfolioError } from '../../src/portfolio/application/errors/portfolio.error.js';
import type { GetPortfolioUseCase } from '../../src/portfolio/application/ports/in/get-portfolio.use-case.js';
import type { Portfolio } from '../../src/portfolio/domain/portfolio.js';
import {
  INVALID_PORTFOLIO_REQUEST_MESSAGE,
  PORTFOLIO_UNAVAILABLE_MESSAGE,
  PORTFOLIO_USER_NOT_FOUND_MESSAGE,
} from '../../src/portfolio/infrastructure/http/http-messages.js';
import { PortfolioController } from '../../src/portfolio/infrastructure/http/portfolio.controller.js';
import { GET_PORTFOLIO_USE_CASE } from '../../src/portfolio/portfolio.tokens.js';

const PORTFOLIO: Portfolio = {
  totalValue: '889756.00',
  availableCash: '627500.00',
  positions: [
    {
      instrumentId: 31,
      ticker: 'DYCA',
      name: 'Dycasa S.A.',
      quantity: -10,
      positionValue: '-15028.00',
      totalReturnPercent: null,
      dailyReturnPercent: -1.15,
    },
    {
      instrumentId: 47,
      ticker: 'PAMP',
      name: 'Pampa Holding S.A.',
      quantity: 40,
      positionValue: '37034.00',
      totalReturnPercent: -0.45,
      dailyReturnPercent: 0.44,
    },
  ],
};

const INVALID = { message: INVALID_PORTFOLIO_REQUEST_MESSAGE };
const NOT_FOUND = { message: PORTFOLIO_USER_NOT_FOUND_MESSAGE };
const UNAVAILABLE = { message: PORTFOLIO_UNAVAILABLE_MESSAGE };

let app: INestApplication;
let rawPort: number;
const execute = vi.fn<GetPortfolioUseCase['execute']>();

beforeAll(async () => {
  const moduleFixture = await Test.createTestingModule({
    controllers: [PortfolioController],
    providers: [
      {
        provide: GET_PORTFOLIO_USE_CASE,
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
  execute.mockResolvedValue(PORTFOLIO);
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

interface RawRequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

function sendRaw(
  path: string,
  options: RawRequestOptions = {},
): Promise<RawResponse> {
  const body = options.body ?? '';
  const headers = { ...(options.headers ?? {}) };

  if (body.length > 0 && headers['Content-Length'] === undefined) {
    headers['Content-Length'] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: rawPort,
        path,
        method: options.method ?? 'GET',
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
    request.end(body);
  });
}

describe('GET /users/:userId/portfolio', () => {
  it('returns the exact direct portfolio object without a wrapper', async () => {
    const response = await request(httpServer())
      .get('/users/1/portfolio')
      .expect(200);

    expect(response.body).toEqual(PORTFOLIO);
    expect(Object.keys(response.body)).toEqual([
      'totalValue',
      'availableCash',
      'positions',
    ]);
    expect(Object.keys(response.body.positions[0])).toEqual([
      'instrumentId',
      'ticker',
      'name',
      'quantity',
      'positionValue',
      'totalReturnPercent',
      'dailyReturnPercent',
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1 });
  });

  it('accepts leading zeroes and both INT boundaries', async () => {
    await request(httpServer()).get('/users/0001/portfolio').expect(200);
    await request(httpServer())
      .get('/users/0002147483647/portfolio')
      .expect(200);

    expect(execute).toHaveBeenNthCalledWith(1, { userId: 1 });
    expect(execute).toHaveBeenNthCalledWith(2, {
      userId: 2_147_483_647,
    });
  });

  it('does not require Idempotency-Key or impose body, query or header rules', async () => {
    const response = await request(httpServer())
      .get('/users/1/portfolio?unexpected=value')
      .set('Idempotency-Key', 'not-a-uuid')
      .set('X-Unexpected', 'value')
      .send({ unexpected: true })
      .expect(200);

    expect(response.body).toEqual(PORTFOLIO);
    expect(execute).toHaveBeenCalledWith({ userId: 1 });
  });

  it.each([
    '/users/0/portfolio',
    '/users/000/portfolio',
    '/users/-1/portfolio',
    '/users/+1/portfolio',
    '/users/1.0/portfolio',
    '/users/1e3/portfolio',
    '/users/0x10/portfolio',
    '/users/abc/portfolio',
    '/users/2147483648/portfolio',
    '/users/0002147483648/portfolio',
    '/users/999999999999999999999/portfolio',
    '/users/%201/portfolio',
    '/users/%EF%BC%91/portfolio',
    '/users/1%2E0/portfolio',
  ])('returns the exact 400 without invoking the use case for %s', async (path) => {
    const response = await request(httpServer()).get(path).expect(400);

    expect(response.body).toEqual(INVALID);
    expect(Object.keys(response.body)).toEqual(['message']);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['user-not-found', NOT_FOUND, 404],
    ['read-failed', UNAVAILABLE, 500],
    ['calculation-failed', UNAVAILABLE, 500],
  ] as const)(
    'maps %s to the exact public response',
    async (code, body, status) => {
      execute.mockRejectedValueOnce(
        new PortfolioError(code, {
          cause: new Error('sensitive driver detail'),
        }),
      );

      const response = await request(httpServer())
        .get('/users/1/portfolio')
        .expect(status);

      expect(response.body).toEqual(body);
      expect(Object.keys(response.body)).toEqual(['message']);
      expect(response.text).not.toContain('sensitive');
    },
  );

  it('maps an unexpected failure to the generic 500', async () => {
    execute.mockRejectedValueOnce(new Error('sensitive driver detail'));

    const response = await request(httpServer())
      .get('/users/1/portfolio')
      .expect(500);

    expect(response.body).toEqual(UNAVAILABLE);
    expect(response.text).not.toContain('sensitive');
  });
});

describe('GET /users/:userId/portfolio parser errors before routing', () => {
  const MARKER = 'FICTIONAL_B07B_R1_MARKER';

  it('returns the exact generic 400 for incomplete JSON without parser details', async () => {
    const raw = await sendRaw('/users/1/portfolio', {
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(Object.keys(JSON.parse(raw.body) as object)).toEqual(['message']);
    expect(raw.body).not.toContain('Unexpected');
    expect(raw.body).not.toContain('statusCode');
    expect(raw.body).not.toContain('error');
    expect(raw.body).not.toContain('SyntaxError');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not reflect a fictional marker from a malformed body', async () => {
    const malformed = `{"marker":"${MARKER}",`;
    const raw = await sendRaw('/users/1/portfolio', {
      headers: { 'Content-Type': 'application/json' },
      body: malformed,
    });

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain(MARKER);
    expect(execute).not.toHaveBeenCalled();
  });

  it('normalizes malformed JSON on an absolute request-target', async () => {
    const absolute = absoluteUrl('/users/1/portfolio');
    const malformed = `{"marker":"${MARKER}",`;
    const raw = await sendRaw(absolute, {
      headers: { 'Content-Type': 'application/json' },
      body: malformed,
    });

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain(MARKER);
    expect(raw.body).not.toContain(absolute);
    expect(execute).not.toHaveBeenCalled();
  });

  it('continues to accept valid JSON on GET portfolio', async () => {
    const raw = await sendRaw('/users/1/portfolio', {
      headers: { 'Content-Type': 'application/json' },
      body: '{"unexpected":true}',
    });

    expect(raw.statusCode).toBe(200);
    expect(JSON.parse(raw.body)).toEqual(PORTFOLIO);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1 });
  });
});

describe('GET /users/:userId/portfolio raw URL escapes', () => {
  it.each([
    '/users/%ZZ/portfolio',
    '/users/%E0%A4%A/portfolio',
    '/users/%E0%A4/portfolio',
    '/users/%FF/portfolio',
  ])('returns the exact 400 for the malformed escape %s', async (path) => {
    const raw = await sendRaw(path);

    expect(raw.statusCode).toBe(400);
    expect(JSON.parse(raw.body)).toEqual(INVALID);
    expect(raw.body).not.toContain('Failed to decode');
    expect(raw.body).not.toContain(path);
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts a valid absolute request-target', async () => {
    const raw = await sendRaw(absoluteUrl('/users/1/portfolio'));

    expect(raw.statusCode).toBe(200);
    expect(JSON.parse(raw.body)).toEqual(PORTFOLIO);
    expect(execute).toHaveBeenCalledWith({ userId: 1 });
  });

  it.each([
    '/users/%ZZ/portfolio',
    '/users/%E0%A4%A/portfolio',
  ])(
    'returns the exact 400 for a malformed escape in an absolute URI: %s',
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
