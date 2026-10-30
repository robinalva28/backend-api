import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { applyTestDatabaseEnvironment } from './support/test-database.js';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

applyTestDatabaseEnvironment();
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'error';
