import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';
import { OPENAPI_DOCUMENT } from '../../src/documentation/openapi.document.js';

let app: INestApplication;

beforeAll(async () => {
  // Documentation is mounted on bootstrap and must not need any business
  // module, PostgreSQL pool or controller to be available.
  const moduleFixture = await Test.createTestingModule({}).compile();
  app = moduleFixture.createNestApplication();
  configureHttpApplication(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

function httpServer(): Parameters<typeof request>[0] {
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe('documentation endpoints', () => {
  it('serves the OpenAPI 3.0.3 document as JSON', async () => {
    const response = await request(httpServer()).get('/openapi.json').expect(200);

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(OPENAPI_DOCUMENT);
    expect(response.body.openapi).toBe('3.0.3');
    expect(Object.keys(response.body.paths)).toHaveLength(4);
  });

  it('redirects /docs to the trailing-slash UI URL', async () => {
    const response = await request(httpServer()).get('/docs').expect(301);

    expect(response.headers.location).toBe('/docs/');
  });

  it('serves Swagger UI HTML with local relative assets and the JSON URL', async () => {
    const response = await request(httpServer()).get('/docs/').expect(200);

    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('<title>backend API</title>');
    expect(response.text).toContain('<div id="swagger-ui"></div>');
    expect(response.text).toContain('./swagger-ui.css');
    expect(response.text).toContain('./swagger-ui-bundle.js');
    expect(response.text).toContain('./swagger-ui-standalone-preset.js');
    expect(response.text).toContain('./swagger-ui-init.js');
    expect(response.text).not.toMatch(/(?:src|href)="https?:\/\//);
  });

  it('loads the same definition from the relative JSON URL', async () => {
    const response = await request(httpServer())
      .get('/docs/swagger-ui-init.js')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/javascript/);
    expect(response.text).toContain('"url": "../openapi.json"');
    expect(response.text).toContain('"validatorUrl": null');
    expect(response.text).not.toContain('validator.swagger.io');
    expect(response.text).not.toContain('http://');
    expect(response.text).not.toContain('https://');
  });

  it('serves local Swagger UI assets', async () => {
    const css = await request(httpServer())
      .get('/docs/swagger-ui.css')
      .expect(200);
    const bundle = await request(httpServer())
      .get('/docs/swagger-ui-bundle.js')
      .expect(200);
    const icon = await request(httpServer())
      .get('/docs/favicon-32x32.png')
      .expect(200);

    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.text.length).toBeGreaterThan(1000);
    expect(bundle.headers['content-type']).toMatch(/javascript/);
    expect(bundle.text.length).toBeGreaterThan(1000);
    expect(icon.headers['content-type']).toMatch(/image\/png/);
    expect(icon.body.length).toBeGreaterThan(0);
  });

  it('does not expose package metadata as a documentation asset', async () => {
    await request(httpServer()).get('/docs/package.json').expect(404);
  });
});
