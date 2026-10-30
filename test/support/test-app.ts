import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { AppModule } from '../../src/app.module.js';
import {
  configureHttpApplication,
  type HttpApplicationOptions,
} from '../../src/bootstrap/configure-http.js';

export async function createTestApplication(
  options: HttpApplicationOptions = {},
): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();

  configureHttpApplication(app, options);
  await app.init();

  return app;
}
