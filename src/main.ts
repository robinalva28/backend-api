import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  ExpressAdapter,
  type NestExpressApplication,
} from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from './app.module.js';
import { configureHttpApplication } from './bootstrap/configure-http.js';
import { PG_POOL } from './database/database.tokens.js';
import { postgresConnectionMode } from './database/postgres.config.js';
import { diagnosticCode, sanitizeDiagnostic } from './shared/diagnostics.js';
import { getOperationalLogger } from './shared/logging/operational-logger.js';

let application: NestExpressApplication | undefined;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
    { logger: false, abortOnError: false },
  );
  application = app;
  const config = app.get(ConfigService);
  const logger = getOperationalLogger();
  const port = config.getOrThrow<number>('PORT');
  const connectionMode = postgresConnectionMode({
    NODE_ENV: config.get<string>('NODE_ENV'),
    DATABASE_URL: config.get<string>('DATABASE_URL'),
  });
  const slowRequestThresholdMs = config.getOrThrow<number>(
    'SLOW_REQUEST_THRESHOLD_MS',
  );

  configureHttpApplication(app, { logger, slowRequestThresholdMs });
  app.enableShutdownHooks();

  logger.info('application.starting', { connectionMode, port });
  await app.get<Pool>(PG_POOL).query('SELECT 1');
  await app.listen(port, '0.0.0.0');
  logger.info('application.listening', { connectionMode, port });
}

try {
  await bootstrap();
} catch (error) {
  writeStartupFailure(error);

  if (application !== undefined) {
    try {
      await application.close();
    } catch {
      // Preserve the original startup failure.
    }
  }

  process.exitCode = 1;
}

function writeStartupFailure(error: unknown): void {
  const code = diagnosticCode(error);
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'application.start_failed',
    ...(code === undefined ? {} : { code }),
    diagnostic: sanitizeDiagnostic(error, 'application-start'),
  };

  process.stderr.write(`${JSON.stringify(entry)}\n`);
}
