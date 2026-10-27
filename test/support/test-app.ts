import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApplication } from '../../src/bootstrap/configure-http.js';

export async function createTestApplication(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication();

  configureHttpApplication(app);
  await app.init();

  return app;
}
