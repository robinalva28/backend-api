import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  ExpressAdapter,
  type NestExpressApplication,
} from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttpApplication } from './bootstrap/configure-http.js';

const app = await NestFactory.create<NestExpressApplication>(
  AppModule,
  new ExpressAdapter(),
);

configureHttpApplication(app);
app.enableShutdownHooks();

const config = app.get(ConfigService);
await app.listen(config.getOrThrow<number>('PORT'), '0.0.0.0');
