import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApplication } from '../support/test-app.js';
import { RecordingLogger } from '../support/recording-logger.js';

let app: INestApplication;
let logger: RecordingLogger;

beforeAll(async () => {
  logger = new RecordingLogger();
  app = await createTestApplication({
    logger,
    generateRequestId: () => 'generated-request-id',
  });
});

afterAll(async () => {
  await app.close();
});

describe('request logging over HTTP', () => {
  it('correlates a failed uppercase order request with its template and validated account', async () => {
    const response = await request(app.getHttpServer())
      .post('/USERS/123/ORDERS?private=hidden-value')
      .set('X-Request-Id', 'uppercase-order-request')
      .send({})
      .expect(400);

    expect(response.headers['x-request-id']).toBe('uppercase-order-request');
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.entries.at(-1)).toMatchObject({
      event: 'http.request.completed',
      fields: {
        requestId: 'uppercase-order-request',
        method: 'POST',
        route: '/users/:userId/orders',
        accountUserId: 123,
        status: 400,
      },
    });
    expect(JSON.stringify(logger.entries)).not.toContain('/USERS/123/ORDERS');
    expect(JSON.stringify(logger.entries)).not.toContain('hidden-value');
  });

  it('returns X-Request-Id and logs a route template without the query string', async () => {
    const response = await request(app.getHttpServer())
      .get('/instruments?query=secret-value&extra=1')
      .set('X-Request-Id', 'client-request-123')
      .expect(400);

    expect(response.headers['x-request-id']).toBe('client-request-123');
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.entries.at(-1)).toMatchObject({
      level: 'info',
      event: 'http.request.completed',
      fields: {
        requestId: 'client-request-123',
        method: 'GET',
        route: '/instruments',
        status: 400,
      },
    });
    expect(logger.events('warn')).toEqual([]);
    expect(JSON.stringify(logger.entries)).not.toContain('secret-value');
    expect(JSON.stringify(logger.entries)).not.toContain('query=');
  });

  it('covers a rejection that happens before the controller', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/%ZZ/portfolio')
      .expect(400);

    expect(response.headers['x-request-id']).toBe('generated-request-id');
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.entries.at(-1)).toMatchObject({
      event: 'http.request.completed',
      fields: {
        route: '/users/:userId/portfolio',
        status: 400,
      },
    });
    expect(logger.entries.at(-1)?.fields).not.toHaveProperty('accountUserId');
  });

  it('replaces an invalid incoming request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/instruments')
      .set('X-Request-Id', 'bad id with spaces')
      .expect(400);

    expect(response.headers['x-request-id']).toBe('generated-request-id');
  });
});
