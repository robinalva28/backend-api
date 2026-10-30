import { describe, expect, it, vi } from 'vitest';
import {
  readLogLevel,
  readSlowRequestThresholdMs,
} from '../../src/shared/logging/log-level.js';
import {
  JsonOperationalLogger,
  getOperationalLogger,
  resetOperationalLoggerForTests,
} from '../../src/shared/logging/operational-logger.js';
import { runWithRequestLogContext } from '../../src/shared/logging/request-context.js';

function createLogger(level: 'error' | 'warn' | 'info' = 'info'): {
  logger: JsonOperationalLogger;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = new JsonOperationalLogger({
    level,
    sink: (line) => lines.push(line),
  });

  return { logger, lines };
}

describe('log configuration', () => {
  it.each([
    [undefined, 'info'],
    ['', 'info'],
    ['INFO', 'info'],
    ['warn', 'warn'],
    [' error ', 'error'],
  ] as const)('reads LOG_LEVEL %j as %s', (value, expected) => {
    expect(readLogLevel(value)).toBe(expected);
  });

  it.each(['debug', 'verbose', 'off', '1'])(
    'rejects the invalid LOG_LEVEL %j',
    (value) => {
      expect(() => readLogLevel(value)).toThrow(/LOG_LEVEL/);
    },
  );

  it('uses a 1000 ms slow-request threshold by default', () => {
    expect(readSlowRequestThresholdMs(undefined)).toBe(1000);
    expect(readSlowRequestThresholdMs('')).toBe(1000);
    expect(readSlowRequestThresholdMs('250')).toBe(250);
  });

  it.each(['0', '-1', '1.5', 'not-a-number', '3600001'])(
    'rejects the invalid slow threshold %j',
    (value) => {
      expect(() => readSlowRequestThresholdMs(value)).toThrow(
        /SLOW_REQUEST_THRESHOLD_MS/,
      );
    },
  );
});

describe('JsonOperationalLogger', () => {
  it('writes one JSON object per event with timestamp, level and event', () => {
    const { logger, lines } = createLogger();

    logger.info('application.listening', {
      connectionMode: 'remote',
      port: 3000,
    });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      event: 'application.listening',
      connectionMode: 'remote',
      port: 3000,
    });
    expect(typeof entry['timestamp']).toBe('string');
    expect(new Date(String(entry['timestamp'])).toISOString()).toBe(
      entry['timestamp'],
    );
  });

  it('filters events below the configured level', () => {
    const { logger, lines } = createLogger('warn');

    logger.info('http.request.completed');
    logger.warn('http.request.slow');
    logger.error('orders.submission.failed');

    expect(lines.map((line) => JSON.parse(line).level)).toEqual([
      'warn',
      'error',
    ]);
  });

  it('adds the active request id to application events', () => {
    const { logger, lines } = createLogger();

    runWithRequestLogContext({ requestId: 'request-123' }, () => {
      logger.warn('orders.retry.scheduled', {
        accountUserId: 42,
        attempt: 2,
        delayMs: 50,
      });
    });

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      requestId: 'request-123',
      accountUserId: 42,
      attempt: 2,
      delayMs: 50,
    });
  });

  it('keeps only allow-listed fields and sanitized diagnostic text', () => {
    const { logger, lines } = createLogger();

    logger.error('orders.submission.failed', {
      requestId: 'request-123',
      method: 'POST',
      route: '/users/:userId/orders',
      status: 500,
      durationMs: 12,
      accountUserId: 42,
      orderId: 81,
      stage: 'commit',
      commitOutcome: 'uncertain',
      code: '40001',
      diagnostic: 'operation=order-submission; Error: redacted',
      ...({
        body: { secret: 'not-logged' },
        query: '?secret=not-logged',
        idempotencyKey: '55555555-5555-4555-8555-555555555555',
        email: 'person@example.com',
      } as Record<string, unknown>),
    });

    const serialized = lines[0] ?? '';
    const entry = JSON.parse(serialized) as Record<string, unknown>;

    expect(entry).toMatchObject({
      requestId: 'request-123',
      method: 'POST',
      route: '/users/:userId/orders',
      status: 500,
      durationMs: 12,
      accountUserId: 42,
      orderId: 81,
      stage: 'commit',
      commitOutcome: 'uncertain',
      code: '40001',
      diagnostic: 'operation=order-submission; Error: redacted',
    });
    expect(serialized).not.toContain('not-logged');
    expect(serialized).not.toContain('55555555');
    expect(serialized).not.toContain('person@example.com');
  });

  it('drops malformed optional values instead of logging raw input', () => {
    const { logger, lines } = createLogger();

    logger.info('http.request.completed', {
      requestId: 'bad id with spaces',
      method: 'post',
      route: '/users/42/portfolio?secret=value',
      status: 99,
      durationMs: -1,
      accountUserId: 0,
      diagnostic: 'safe',
    });

    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).not.toHaveProperty('requestId');
    expect(entry).not.toHaveProperty('method');
    expect(entry).not.toHaveProperty('route');
    expect(entry).not.toHaveProperty('status');
    expect(entry).not.toHaveProperty('durationMs');
    expect(entry).not.toHaveProperty('accountUserId');
    expect(entry['diagnostic']).toBe('safe');
  });

  it('uses info by default and can be reset after changing the environment', () => {
    const original = process.env['LOG_LEVEL'];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    try {
      process.env['LOG_LEVEL'] = 'warn';
      resetOperationalLoggerForTests();
      getOperationalLogger().info('application.starting');
      expect(write).not.toHaveBeenCalled();

      process.env['LOG_LEVEL'] = 'info';
      resetOperationalLoggerForTests();
      getOperationalLogger().info('application.starting');
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) {
        delete process.env['LOG_LEVEL'];
      } else {
        process.env['LOG_LEVEL'] = original;
      }

      resetOperationalLoggerForTests();
      write.mockRestore();
    }
  });
});
